import { useCallback, useEffect, useMemo, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type AppNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string | null;
  body: string | null;
  cta_label: string | null;
  cta_url: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

export function useNotifications(session: Session) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: qError } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (qError) throw qError;
      setNotifications((data || []) as AppNotification[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [session.user.id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.is_read).length, [notifications]);

  const markAsRead = useCallback(
    async (notificationId: string) => {
      const target = notifications.find((item) => item.id === notificationId);
      if (!target || target.is_read) return;
      const nowIso = new Date().toISOString();
      const { error: uError } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: nowIso })
        .eq('id', notificationId)
        .eq('user_id', session.user.id);
      if (uError) throw uError;
      setNotifications((prev) =>
        prev.map((item) => (item.id === notificationId ? { ...item, is_read: true, read_at: nowIso } : item)),
      );
    },
    [notifications, session.user.id],
  );

  const markAllAsRead = useCallback(async () => {
    const hasUnread = notifications.some((item) => !item.is_read);
    if (!hasUnread) return;
    const nowIso = new Date().toISOString();
    const { error: uError } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: nowIso })
      .eq('user_id', session.user.id)
      .eq('is_read', false);
    if (uError) throw uError;
    setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true, read_at: nowIso })));
  }, [notifications, session.user.id]);

  return { notifications, unreadCount, loading, error, refetch, markAsRead, markAllAsRead };
}
