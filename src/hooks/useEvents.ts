import { useState, useEffect, useRef, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Event, EventParticipant, Expense, Profile } from '../dbAliases';

type GroupMemberWithProfile = {
  id: string;
  user_id: string;
  role: string;
  status: string;
  profile: Profile | null;
};

type EventParticipantWithProfile = EventParticipant & {
  profile: Profile | null;
};

export type EventDetailData = Event & {
  group: {
    id: string;
    name: string;
    description: string | null;
    members: GroupMemberWithProfile[];
  };
  participants: EventParticipantWithProfile[];
  expenses: Array<
    Expense & {
      profiles?: { full_name: string | null; avatar_url: string | null } | null;
      splits?: Array<{ user_id: string; share_cents: number; percentage: number | null }> | null;
    }
  >;
};

type MutationResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  /** Extra context from edge function JSON body, e.g. `details` field */
  details?: string;
};

type QueryLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

function readFnErrorMessage(
  fnError: { message?: string } | null,
  data: unknown,
  fallback: string,
): string {
  let message = fnError?.message || fallback;
  if (data && typeof data === 'object' && 'error' in data) {
    const maybeError = (data as { error?: unknown }).error;
    if (typeof maybeError === 'string' && maybeError.trim()) {
      message = maybeError;
    }
  }
  return message;
}

/** Parses create-event JSON body; prefers `error` / `details` over generic Functions client message. */
function extractCreateEventFailure(
  data: unknown,
  fnError: { message?: string } | null,
): { error: string; details?: string } {
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (o.error !== undefined && o.error !== null && String(o.error).trim() !== '') {
      const error = typeof o.error === 'string' ? o.error : String(o.error);
      let details: string | undefined;
      if (o.details !== undefined && o.details !== null) {
        details = typeof o.details === 'string' ? o.details : JSON.stringify(o.details);
      }
      return { error, details };
    }
  }
  return {
    error: readFnErrorMessage(fnError, data, 'Failed to create event'),
  };
}

export type EventsStatusFilter = 'draft' | 'open' | 'closed';

export function useEvents(
  session: Session,
  groupId?: string,
  statusFilter?: EventsStatusFilter | null,
) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  /** Ignores stale responses when group/status filter changes mid-request. */
  const fetchSeqRef = useRef(0);

  const fetchEvents = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      setLoading(true);
      setError(null);

      const runQuery = async (orderBy: 'starts_at' | 'created_at') => {
        let query = supabase
          .from('events')
          .select('*')
          .order(orderBy, { ascending: false });
        if (groupId) {
          query = query.eq('group_id', groupId);
        }
        if (statusFilter != null) {
          query = query.eq('status', statusFilter);
        }
        return query;
      };

      let { data, error } = await runQuery('starts_at');
      if (seq !== fetchSeqRef.current) return;

      // Backward-compatible fallback for environments where starts_at migration is missing.
      if (error && (error.code === '42703' || error.message?.toLowerCase().includes('starts_at'))) {
        const fallback = await runQuery('created_at');
        if (seq !== fetchSeqRef.current) return;
        data = fallback.data;
        error = fallback.error;
      }

      if (seq !== fetchSeqRef.current) return;
      if (error) throw error;
      setEvents(data || []);
    } catch (err: unknown) {
      if (seq !== fetchSeqRef.current) return;
      const queryError = err as QueryLikeError | null;
      const message =
        err instanceof Error
          ? err.message
          : queryError?.message || queryError?.details || queryError?.hint || 'Failed to load events';
      setError(message);
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, statusFilter]);

  const createEvent = async (
    title: string,
    description: string,
    groupId: string,
    status: 'open' | 'draft' = 'open',
    startsAt: string,
    endsAt?: string | null,
  ): Promise<MutationResult<Event>> => {
    setActionLoading(true);
    setError(null);

    try {
      const payload = {
        group_id: groupId,
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        status,
        starts_at: startsAt,
        ends_at: endsAt ?? null,
      };
      console.log('[create-event] request payload', JSON.stringify(payload));

      const { data, error: fnError } = await supabase.functions.invoke('create-event', {
        body: payload,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      console.log('[create-event] response body', data);
      if (data !== undefined && data !== null) {
        try {
          console.log('[create-event] response body (JSON string)', JSON.stringify(data));
        } catch {
          console.log('[create-event] response body (JSON string) — stringify failed');
        }
      }

      const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      const bodyHasError =
        body != null &&
        'error' in body &&
        body.error !== undefined &&
        body.error !== null &&
        String(body.error).trim() !== '';

      if (fnError || bodyHasError) {
        const extracted = extractCreateEventFailure(data, fnError);
        setError(extracted.error);
        return { success: false, error: extracted.error, details: extracted.details };
      }

      await fetchEvents();
      const createdEvent = data && typeof data === 'object' && 'event' in data
        ? ((data as { event?: Event }).event ?? undefined)
        : undefined;
      return { success: true, data: createdEvent };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create event';
      setError(message);
      return { success: false, error: message };
    } finally {
      setActionLoading(false);
    }
  };

  const getEventDetails = async (eventId: string): Promise<MutationResult<EventDetailData>> => {
    try {
      const { data: event, error: eventError } = await supabase
        .from('events')
        .select(`
          *,
          group:groups(
            *,
            members:group_members(
              *,
              profile:profiles(*)
            )
          ),
          participants:event_participants(
            *,
            profile:profiles(*)
          ),
          expenses:expenses(
            *,
            profiles:profiles!expenses_paid_by_user_id_fkey(full_name, avatar_url),
            splits:expense_splits(user_id, share_cents, percentage)
          )
        `)
        .eq('id', eventId)
        .single();

      if (eventError) throw eventError;
      const normalized: EventDetailData = {
        ...(event as Event),
        group: {
          ...((event as { group: EventDetailData['group'] }).group || { id: '', name: '', description: null, members: [] }),
          members: ((((event as { group?: { members?: GroupMemberWithProfile[] } }).group?.members) || []) as GroupMemberWithProfile[]).map(
            (member) => ({
              ...member,
              profile: Array.isArray(member.profile) ? member.profile[0] ?? null : member.profile ?? null,
            }),
          ),
        },
        participants: (((event as { participants?: EventParticipantWithProfile[] }).participants) || []).map((participant) => ({
          ...participant,
          profile: Array.isArray(participant.profile) ? participant.profile[0] ?? null : participant.profile ?? null,
        })),
        expenses: (((event as { expenses?: EventDetailData['expenses'] }).expenses) || []).map((exp) => {
          const prof = exp.profiles as unknown;
          const profile = Array.isArray(prof) ? prof[0] : prof;
          return { ...exp, profiles: (profile ?? null) as { full_name: string | null; avatar_url: string | null } | null };
        }),
      };
      return { success: true, data: normalized };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load event details';
      return { success: false, error: message };
    }
  };

  const addParticipant = async (eventId: string, userId: string): Promise<MutationResult> => {
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('add-event-participant', {
        body: {
          event_id: eventId,
          user_id: userId,
          status: 'pending',
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        const message = readFnErrorMessage(error, data, 'Failed to add participant');
        throw new Error(message);
      }
      if (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error) {
        throw new Error(String((data as { error: unknown }).error));
      }
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add participant';
      return { success: false, error: message };
    } finally {
      setActionLoading(false);
    }
  };

  const updateEventDetails = async (
    eventId: string,
    input: {
      title: string;
      description: string | null;
      participantUserIds: string[];
      startsAt: string;
      endsAt?: string | null;
      recalculateDraftExpenses?: boolean;
    }
  ): Promise<MutationResult> => {
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('update-event', {
        body: {
          event_id: eventId,
          title: input.title.trim(),
          description: input.description,
          participant_user_ids: input.participantUserIds,
          starts_at: input.startsAt,
          ends_at: input.endsAt ?? null,
          recalculate_draft_expenses: input.recalculateDraftExpenses,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        const message = readFnErrorMessage(error, data, 'Failed to update event');
        throw new Error(message);
      }
      if (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error) {
        throw new Error(String((data as { error: unknown }).error));
      }

      return { success: true as const };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update event';
      return { success: false as const, error: message };
    } finally {
      setActionLoading(false);
    }
  };

  const closeEvent = async (eventId: string): Promise<MutationResult> => {
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('close-event', {
        body: { event_id: eventId },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (error) {
        const message = readFnErrorMessage(error, data, 'Failed to close event');
        throw new Error(message);
      }
      if (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error) {
        throw new Error(String((data as { error: unknown }).error));
      }
      return { success: true as const };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to close event';
      return { success: false as const, error: message };
    } finally {
      setActionLoading(false);
    }
  };

  const finalizeEvent = async (eventId: string): Promise<MutationResult> => {
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('events')
        .update({ status: 'open' })
        .eq('id', eventId);
      if (error) throw error;
      return { success: true as const };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to finalize event';
      return { success: false as const, error: message };
    } finally {
      setActionLoading(false);
    }
  };

  /** RSVP: atualiza o estado do próprio participante (going / not_going). */
  const setMyParticipantStatus = useCallback(
    async (eventId: string, status: 'going' | 'not_going'): Promise<MutationResult> => {
      try {
        const { error } = await supabase
          .from('event_participants')
          .update({ status })
          .eq('event_id', eventId)
          .eq('user_id', session.user.id);
        if (error) throw error;
        return { success: true as const };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Failed to update attendance';
        return { success: false as const, error: message };
      }
    },
    [session.user.id],
  );

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return {
    events,
    loading,
    error,
    actionLoading,
    fetchEvents,
    createEvent,
    getEventDetails,
    addParticipant,
    updateEventDetails,
    closeEvent,
    finalizeEvent,
    setMyParticipantStatus,
  };
}
