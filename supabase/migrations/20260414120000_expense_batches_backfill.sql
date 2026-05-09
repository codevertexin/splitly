-- =============================================================================
-- Fase 1 — Normalização estrutural de batches (sem retroatividade de negócio)
-- =============================================================================
-- Regra explícita de backfill:
--   1) Criar batch inicial *técnico* apenas quando necessário (grupo sem batch
--      ativo e ainda com despesas sem batch_id).
--   2) Preencher expenses.batch_id onde estiver NULL, amarrando ao batch ativo
--      do grupo (existente ou recém-criado nesta migração).
--   3) NÃO alterar expense_splits.
--   4) NÃO alterar settlements.
--   5) NÃO alterar datas históricas das despesas (incurred_at, created_at, …)
--      nem settled_at dos settlements.
-- Isto é apenas normalização estrutural para alinhar o modelo com ciclos.
-- =============================================================================

-- 1) Tabela de ciclos (idempotente se já existir noutra migração remota)
CREATE TABLE IF NOT EXISTS public.expense_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NULL,
  is_active boolean NOT NULL DEFAULT true,
  closed_at timestamptz NULL,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expense_batches_group_id_idx
  ON public.expense_batches (group_id);

-- 2) Coluna batch_id em expenses (nullable até backfill)
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.expense_batches(id);

CREATE INDEX IF NOT EXISTS expenses_batch_id_idx
  ON public.expenses (batch_id);

-- 3) No máximo um batch ativo por grupo: antes do índice único, desativar
--    duplicados (mantém o mais antigo por created_at).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY group_id
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.expense_batches
  WHERE is_active = true
)
UPDATE public.expense_batches b
SET is_active = false
FROM ranked r
WHERE b.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS expense_batches_one_active_per_group
  ON public.expense_batches (group_id)
  WHERE (is_active = true);

-- 4) Despesas órfãs: ligar ao batch ativo do mesmo grupo, se existir
UPDATE public.expenses e
SET batch_id = b.id
FROM public.expense_batches b
WHERE e.batch_id IS NULL
  AND e.deleted_at IS NULL
  AND b.group_id = e.group_id
  AND b.is_active = true;

-- 5) Grupos que ainda têm despesas sem batch_id e *não* têm batch ativo:
--    inserir batch técnico (um por grupo) — sem tocar em splits/settlements/datas
INSERT INTO public.expense_batches (
  group_id,
  title,
  description,
  is_active,
  closed_at,
  created_by
)
SELECT DISTINCT
  e.group_id,
  'Legacy cycle (backfill)',
  'Structural normalization: historical expenses had no batch_id. expense_splits, settlements and expense timestamps were not modified.',
  true,
  NULL::timestamptz,
  NULL::uuid
FROM public.expenses e
WHERE e.deleted_at IS NULL
  AND e.batch_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.expense_batches b
    WHERE b.group_id = e.group_id
      AND b.is_active = true
  );

-- 6) Voltar a preencher batch_id após criar batches técnicos
UPDATE public.expenses e
SET batch_id = b.id
FROM public.expense_batches b
WHERE e.batch_id IS NULL
  AND e.deleted_at IS NULL
  AND b.group_id = e.group_id
  AND b.is_active = true;

-- 7) Grupos sem qualquer batch (ex.: legado sem despesas): um ciclo ativo mínimo.
--    Não altera despesas nem settlements (não há linhas a ligar).
INSERT INTO public.expense_batches (
  group_id,
  title,
  description,
  is_active,
  closed_at,
  created_by
)
SELECT
  g.id,
  'Initial cycle (backfill)',
  'Structural normalization: group had no expense_batches row. No expense or settlement rows modified.',
  true,
  NULL::timestamptz,
  NULL::uuid
FROM public.groups g
WHERE NOT EXISTS (
  SELECT 1 FROM public.expense_batches b WHERE b.group_id = g.id
);

-- 8) RLS: membros ativos podem ler batches do grupo (alinhado com leitura de despesas na app)
ALTER TABLE public.expense_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_batches_select_group_members ON public.expense_batches;
CREATE POLICY expense_batches_select_group_members
  ON public.expense_batches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = expense_batches.group_id
        AND gm.user_id = (SELECT auth.uid())
        AND gm.status = 'active'
    )
  );
