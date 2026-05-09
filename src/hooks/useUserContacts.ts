import { useState, useEffect, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { UserContact } from '../dbAliases';

export type UserContactRow = UserContact & {
  contact_profile: { full_name: string | null; avatar_url: string | null; username: string | null } | null;
};

export type CoMemberSuggestion = {
  user_id: string;
  full_name: string | null;
};

export function useUserContacts(session: Session | null) {
  const [contacts, setContacts] = useState<UserContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchContacts = useCallback(async () => {
    if (!session) {
      setContacts([]);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: qError } = await supabase
        .from('user_contacts')
        .select(
          `
          *,
          contact_profile:profiles!user_contacts_contact_user_id_fkey(full_name, avatar_url, username)
        `,
        )
        .eq('owner_user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (qError) throw qError;

      setContacts((data as UserContactRow[]) || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load contacts';
      console.error('useUserContacts:', msg);
      setError(msg);
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  const updateCategory = useCallback(
    async (contactId: string, category: UserContact['category']) => {
      if (!session) return { success: false as const, error: 'No session' };
      setActionLoading(true);
      try {
        const { error: uError } = await supabase
          .from('user_contacts')
          .update({ category })
          .eq('id', contactId)
          .eq('owner_user_id', session.user.id);
        if (uError) throw uError;
        await fetchContacts();
        return { success: true as const };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Update failed';
        return { success: false as const, error: msg };
      } finally {
        setActionLoading(false);
      }
    },
    [session, fetchContacts],
  );

  const setBlocked = useCallback(
    async (contactId: string, blocked: boolean) => {
      if (!session) return { success: false as const, error: 'No session' };
      setActionLoading(true);
      try {
        const { error: uError } = await supabase
          .from('user_contacts')
          .update({ status: blocked ? 'blocked' : 'active' })
          .eq('id', contactId)
          .eq('owner_user_id', session.user.id);
        if (uError) throw uError;
        await fetchContacts();
        return { success: true as const };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Update failed';
        return { success: false as const, error: msg };
      } finally {
        setActionLoading(false);
      }
    },
    [session, fetchContacts],
  );

  const removeContact = useCallback(
    async (contactId: string) => {
      if (!session) return { success: false as const, error: 'No session' };
      setActionLoading(true);
      try {
        const { error: dError } = await supabase
          .from('user_contacts')
          .delete()
          .eq('id', contactId)
          .eq('owner_user_id', session.user.id);
        if (dError) throw dError;
        await fetchContacts();
        return { success: true as const };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Delete failed';
        return { success: false as const, error: msg };
      } finally {
        setActionLoading(false);
      }
    },
    [session, fetchContacts],
  );

  const addContacts = useCallback(
    async (userIds: string[]) => {
      if (!session) return { success: false as const, error: 'No session' };
      const uid = session.user.id;
      const rows = userIds
        .filter((id) => id && id !== uid)
        .map((contact_user_id) => ({
          owner_user_id: uid,
          contact_user_id,
          source: 'manual' as const,
          category: 'friend' as const,
          status: 'active' as const,
        }));
      if (rows.length === 0) return { success: true as const };
      setActionLoading(true);
      try {
        const { error: iError } = await supabase.from('user_contacts').upsert(rows, {
          onConflict: 'owner_user_id,contact_user_id',
          ignoreDuplicates: true,
        });
        if (iError) throw iError;
        await fetchContacts();
        return { success: true as const };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Add failed';
        return { success: false as const, error: msg };
      } finally {
        setActionLoading(false);
      }
    },
    [session, fetchContacts],
  );

  const fetchCoMemberSuggestions = useCallback(async (): Promise<CoMemberSuggestion[]> => {
    if (!session) return [];

    const { data: mine, error: e1 } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', session.user.id)
      .eq('status', 'active');
    if (e1) throw e1;

    const groupIds = [...new Set((mine || []).map((m) => m.group_id))];
    if (groupIds.length === 0) return [];

    const { data: members, error: e2 } = await supabase
      .from('group_members')
      .select('user_id, profiles(full_name)')
      .in('group_id', groupIds)
      .eq('status', 'active')
      .neq('user_id', session.user.id);
    if (e2) throw e2;

    const byUser = new Map<string, string | null>();
    for (const row of members || []) {
      const r = row as { user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null };
      const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      if (!byUser.has(r.user_id)) {
        byUser.set(r.user_id, prof?.full_name ?? null);
      }
    }

    return Array.from(byUser.entries()).map(([user_id, full_name]) => ({ user_id, full_name }));
  }, [session]);

  return {
    contacts,
    loading,
    error,
    actionLoading,
    refetch: fetchContacts,
    updateCategory,
    setBlocked,
    removeContact,
    addContacts,
    fetchCoMemberSuggestions,
  };
}
