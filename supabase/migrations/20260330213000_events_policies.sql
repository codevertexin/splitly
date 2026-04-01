-- RLS para eventos: permitir que membros ativos de um grupo criem e vejam eventos desse grupo.

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer utilizador autenticado que seja membro ativo do grupo.
DROP POLICY IF EXISTS "events_select_members" ON public.events;
CREATE POLICY "events_select_members" ON public.events
  FOR SELECT
  TO authenticated
  USING (
    public.is_group_member(events.group_id)
  );

-- Inserção: apenas membros ativos do grupo podem criar eventos nesse grupo.
DROP POLICY IF EXISTS "events_insert_members" ON public.events;
CREATE POLICY "events_insert_members" ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_member(events.group_id)
  );

