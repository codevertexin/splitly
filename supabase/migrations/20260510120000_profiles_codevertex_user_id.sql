-- Phase 1 (CodeVertex Core): map local profile row to central identity (filled in Phase 2).
-- Does not change PK, FKs, or RLS (still auth.uid() = profiles.id).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS codevertex_user_id uuid NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_codevertex_user_id_unique
  ON public.profiles (codevertex_user_id)
  WHERE codevertex_user_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.codevertex_user_id IS
  'CodeVertex Auth Core user id; nullable until linked on login (Phase 2).';
