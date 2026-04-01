-- Permitir que o dono (owner) ativo do grupo atualize linhas em public.groups
-- (nome, descrição, archived_at, etc.). A app só envia estes campos.

DROP POLICY IF EXISTS "groups_update_owner" ON public.groups;

CREATE POLICY "groups_update_owner" ON public.groups
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = groups.id
        AND gm.user_id = (SELECT auth.uid())
        AND gm.role = 'owner'
        AND gm.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = groups.id
        AND gm.user_id = (SELECT auth.uid())
        AND gm.role = 'owner'
        AND gm.status = 'active'
    )
  );
