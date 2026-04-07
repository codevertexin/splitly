import type { SupabaseClient } from '@supabase/supabase-js';

/** Client-side guard: creating/linking an expense to an event that is closed or wrong group must fail before insert. */
export async function assertEventAllowsNewExpense(
  client: SupabaseClient,
  groupId: string,
  eventId: string | null | undefined,
): Promise<void> {
  if (!eventId) return;
  const { data, error } = await client.from('events').select('group_id, status').eq('id', eventId).maybeSingle();
  if (error || !data) throw new Error('EVENT_NOT_FOUND');
  if (data.group_id !== groupId) throw new Error('EVENT_GROUP_MISMATCH');
  if (data.status === 'closed') throw new Error('EVENT_CLOSED');
}
