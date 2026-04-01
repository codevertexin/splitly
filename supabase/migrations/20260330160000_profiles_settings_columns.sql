-- Preferências de perfil: idioma, fuso, onboarding (full_name, avatar_url, default_currency assumidos na app).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language text,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC' NOT NULL,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.profiles.preferred_language IS 'Interface language: en | pt-PT | es (app-validated).';
COMMENT ON COLUMN public.profiles.timezone IS 'IANA timezone, e.g. Europe/Lisbon';
COMMENT ON COLUMN public.profiles.onboarding_completed IS 'True after user finished first-run onboarding in the app.';

-- Permitir que o utilizador autenticado atualize o próprio perfil.
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));
