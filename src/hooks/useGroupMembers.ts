import { useState, useEffect, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Database } from '../types';
import { socialDisplayName } from '../lib/displayName';

export type GroupMemberRole = Database['public']['Enums']['group_role'];

export type GroupMemberRow = {
  user_id: string;
  role: GroupMemberRole;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

/** Label para UI: nome legível; nunca mostrar UUID cru. */
export function memberLabel(m: Pick<GroupMemberRow, 'full_name' | 'username' | 'user_id'>): string {
  return socialDisplayName({ full_name: m.full_name, username: m.username }, m.user_id);
}

export function useGroupMembers(session: Session | null, groupId: string | undefined) {
  const [members, setMembers] = useState<GroupMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!session) {
      setMembers([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (!groupId) {
      setMembers([]);
      setError(null);
      setLoading(true);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: qError } = await supabase
        .from('group_members')
        .select('user_id, role, profiles(full_name, avatar_url, username)')
        .eq('group_id', groupId)
        .eq('status', 'active');

      if (qError) throw qError;

      const rows: GroupMemberRow[] = (data || []).map((row: any) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return {
          user_id: row.user_id,
          role: row.role as GroupMemberRole,
          full_name: profile?.full_name?.trim() || null,
          username: profile?.username?.trim() || null,
          avatar_url: profile?.avatar_url || null,
        };
      });

      rows.sort((a, b) => memberLabel(a).localeCompare(memberLabel(b)));

      setMembers(rows);
    } catch (err: any) {
      console.error('useGroupMembers:', err.message);
      setError(err.message);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [session, groupId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  return { members, loading, error, refetch: fetchMembers };
}