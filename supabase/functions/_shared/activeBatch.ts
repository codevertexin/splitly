import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Batch ativo do grupo (um por group_id). */
export async function getActiveBatchIdForGroup(
  adminClient: SupabaseClient,
  groupId: string,
): Promise<{ batchId: string } | { error: string }> {
  const { data, error } = await adminClient
    .from('expense_batches')
    .select('id')
    .eq('group_id', groupId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data?.id) {
    return {
      error:
        'No active expense batch for this group. Close any duplicate actives or run DB migration.',
    };
  }
  return { batchId: data.id };
}
