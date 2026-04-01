-- Pessoas que conheces (convites de grupo, partilha da app, ou manual).
-- Aplica no SQL Editor do Supabase ou com supabase db push.

CREATE TYPE public.contact_category AS ENUM ('friend', 'family', 'colleague', 'other');
CREATE TYPE public.contact_status AS ENUM ('active', 'blocked');
CREATE TYPE public.contact_source AS ENUM ('manual', 'group_invite', 'app_share');

CREATE TABLE public.user_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contact_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category public.contact_category NOT NULL DEFAULT 'friend',
  status public.contact_status NOT NULL DEFAULT 'active',
  source public.contact_source NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_contacts_distinct_users CHECK (owner_user_id <> contact_user_id),
  CONSTRAINT user_contacts_owner_contact_unique UNIQUE (owner_user_id, contact_user_id)
);

CREATE INDEX user_contacts_owner_idx ON public.user_contacts (owner_user_id);
CREATE INDEX user_contacts_owner_status_idx ON public.user_contacts (owner_user_id, status);

CREATE OR REPLACE FUNCTION public.touch_user_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_contacts_updated_at
  BEFORE UPDATE ON public.user_contacts
  FOR EACH ROW
  EXECUTE PROCEDURE public.touch_user_contacts_updated_at();

ALTER TABLE public.user_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_contacts_select_own
  ON public.user_contacts FOR SELECT
  USING (auth.uid() = owner_user_id);

CREATE POLICY user_contacts_insert_own
  ON public.user_contacts FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY user_contacts_update_own
  ON public.user_contacts FOR UPDATE
  USING (auth.uid() = owner_user_id);

CREATE POLICY user_contacts_delete_own
  ON public.user_contacts FOR DELETE
  USING (auth.uid() IS NOT NULL AND auth.uid() = owner_user_id);

-- Ver perfil de contactos guardados (nome na lista de convidados).
CREATE POLICY profiles_select_for_contact_owners
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT contact_user_id FROM public.user_contacts WHERE owner_user_id = auth.uid()
    )
  );

-- Ver perfil de colegas de grupo (para "adicionar dos meus grupos").
CREATE POLICY profiles_select_co_members
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT gm.user_id
      FROM public.group_members gm
      INNER JOIN public.group_members me
        ON me.group_id = gm.group_id AND me.user_id = auth.uid()
      WHERE gm.status = 'active' AND me.status = 'active'
    )
  );
