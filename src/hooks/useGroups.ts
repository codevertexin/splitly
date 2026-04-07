import { useState, useEffect, useRef } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Group } from '../types';

export function useGroups(session: Session) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const fetchingRef = useRef(false);

  const fetchGroups = async () => {
  if (fetchingRef.current) return

  try {
    fetchingRef.current = true
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('groups')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    setGroups(data || [])
  } catch (err: any) {
    console.error('Error fetching groups:', err.message)
    setError(err.message)
  } finally {
    setLoading(false)
    fetchingRef.current = false
  }
}

  const createGroup = async (name: string, description: string) => {
    setActionLoading(true);
    setError(null);

    try {
      const { data, error: funcError } = await supabase.functions.invoke('create-group', {
        body: { name, description },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (funcError) throw funcError;

      await fetchGroups();
      const groupId =
        data && typeof data === 'object' && data !== null && 'group' in data
          ? ((data as { group?: { id?: string } }).group?.id ?? null)
          : null;
      return { success: true as const, groupId };
    } catch (err: any) {
      setError(err.message || 'Failed to create group');
      return { success: false, error: err.message };
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    if (!session?.user) {
      setGroups([]);
      setLoading(false);
      return;
    }
    void fetchGroups();
  }, [session?.user?.id]);

  const updateGroup = async (groupId: string, name: string, description: string) => {
    setActionLoading(true);
    setError(null);
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    if (trimmedName.length < 2) {
      setActionLoading(false);
      return { success: false as const, error: 'NAME_TOO_SHORT' };
    }
    try {
      const { error: uError } = await supabase
        .from('groups')
        .update({
          name: trimmedName,
          description: trimmedDesc || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', groupId);

      if (uError) throw uError;
      await fetchGroups();
      return { success: true as const };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      setError(msg);
      return { success: false as const, error: msg };
    } finally {
      setActionLoading(false);
    }
  };

  /** Arquiva o grupo (soft delete). Requer saldos a zero — validar na UI. */
  const archiveGroup = async (groupId: string) => {
    setActionLoading(true);
    setError(null);
    try {
      const { error: uError } = await supabase
        .from('groups')
        .update({
          archived_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', groupId);

      if (uError) throw uError;
      await fetchGroups();
      return { success: true as const };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Archive failed';
      setError(msg);
      return { success: false as const, error: msg };
    } finally {
      setActionLoading(false);
    }
  };

  return {
    groups,
    loading,
    error,
    actionLoading,
    fetchGroups,
    createGroup,
    updateGroup,
    archiveGroup,
  };
}
