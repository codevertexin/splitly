-- Waitlist / "notify me" for unreleased features (e.g. scan receipt).
SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS public.feature_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  email text NULL,
  message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_interest_feature_key_len CHECK (
    char_length(feature_key) >= 1 AND char_length(feature_key) <= 128
  ),
  CONSTRAINT feature_interest_email_len CHECK (
    email IS NULL OR char_length(email) <= 320
  ),
  CONSTRAINT feature_interest_message_len CHECK (
    message IS NULL OR char_length(message) <= 4000
  ),
  CONSTRAINT feature_interest_user_feature_unique UNIQUE (user_id, feature_key)
);

CREATE INDEX IF NOT EXISTS feature_interest_user_idx ON public.feature_interest (user_id);
CREATE INDEX IF NOT EXISTS feature_interest_feature_idx ON public.feature_interest (feature_key);

CREATE OR REPLACE FUNCTION public.touch_feature_interest_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feature_interest_updated_at ON public.feature_interest;
CREATE TRIGGER trg_feature_interest_updated_at
  BEFORE UPDATE ON public.feature_interest
  FOR EACH ROW
  EXECUTE PROCEDURE public.touch_feature_interest_updated_at();

ALTER TABLE public.feature_interest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_interest_select_own ON public.feature_interest;
CREATE POLICY feature_interest_select_own
  ON public.feature_interest FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS feature_interest_insert_own ON public.feature_interest;
CREATE POLICY feature_interest_insert_own
  ON public.feature_interest FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS feature_interest_update_own ON public.feature_interest;
CREATE POLICY feature_interest_update_own
  ON public.feature_interest FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
