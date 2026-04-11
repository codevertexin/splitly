-- Eventos: visível apenas a quem está em event_participants OU é o criador.
-- Despesas com event_id: visível no grupo só se o utilizador tiver acesso ao evento.
-- RSVP: cada utilizador pode atualizar o próprio event_participants.status.

CREATE OR REPLACE FUNCTION public.user_can_access_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND (
        e.created_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.event_participants ep
          WHERE ep.event_id = e.id
            AND ep.user_id = auth.uid()
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_event(uuid) TO authenticated;

-- events: substituir leitura por grupo por leitura por convite/criador
DROP POLICY IF EXISTS "events_select_members" ON public.events;
CREATE POLICY "events_select_invited_or_creator"
  ON public.events
  FOR SELECT
  TO authenticated
  USING (public.user_can_access_event(id));

-- finalizeEvent (client) e outras edições pelo criador
DROP POLICY IF EXISTS "events_update_creator" ON public.events;
CREATE POLICY "events_update_creator"
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- event_participants: ver participantes dos eventos a que se tem acesso
DROP POLICY IF EXISTS "event_participants_select_visible" ON public.event_participants;
CREATE POLICY "event_participants_select_visible"
  ON public.event_participants
  FOR SELECT
  TO authenticated
  USING (public.user_can_access_event(event_id));

DROP POLICY IF EXISTS "event_participants_update_own_rsvp" ON public.event_participants;
CREATE POLICY "event_participants_update_own_rsvp"
  ON public.event_participants
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.user_can_access_event(event_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.user_can_access_event(event_id)
  );

-- expenses: uma única política SELECT (evita OR com regras antigas só por grupo)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'expenses'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.expenses', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "expenses_select_group_event_aware"
  ON public.expenses
  FOR SELECT
  TO authenticated
  USING (
    public.is_group_member(group_id)
    AND (
      event_id IS NULL
      OR public.user_can_access_event(event_id)
    )
  );

-- expense_splits: alinhar com a mesma regra da despesa (nested selects / PostgREST)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'expense_splits'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.expense_splits', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "expense_splits_select_via_expense"
  ON public.expense_splits
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.expenses ex
      WHERE ex.id = expense_splits.expense_id
        AND public.is_group_member(ex.group_id)
        AND (
          ex.event_id IS NULL
          OR public.user_can_access_event(ex.event_id)
        )
    )
  );
