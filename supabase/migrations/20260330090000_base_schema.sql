-- Base schema required for local development.
-- This repo relies on tables referenced by later migrations and by the app code.
-- Keep this migration minimal and compatible with subsequent ALTER/POLICY migrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = public, extensions;

-- Enums (only those not created elsewhere)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'group_role') THEN
    CREATE TYPE public.group_role AS ENUM ('owner', 'member');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status') THEN
    CREATE TYPE public.membership_status AS ENUM ('active', 'invited', 'left');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invite_status') THEN
    CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_status') THEN
    CREATE TYPE public.event_status AS ENUM ('draft', 'open', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'participant_status') THEN
    CREATE TYPE public.participant_status AS ENUM ('going', 'not_going', 'pending');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'split_method') THEN
    CREATE TYPE public.split_method AS ENUM ('equal', 'manual', 'percentage', 'smart');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_status') THEN
    CREATE TYPE public.expense_status AS ENUM ('draft', 'confirmed');
  END IF;
END $$;

-- Profiles (referenced by almost everything)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  full_name text NULL,
  avatar_url text NULL,
  username text NULL,
  default_currency text NOT NULL DEFAULT 'EUR',
  preferred_language text NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to select their own profile by default.
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Groups
CREATE TABLE IF NOT EXISTS public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  base_currency text NOT NULL DEFAULT 'EUR',
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- Group members
CREATE TABLE IF NOT EXISTS public.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.group_role NOT NULL DEFAULT 'member',
  status public.membership_status NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS group_members_group_user_unique
  ON public.group_members (group_id, user_id);

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Membership helper functions used by RLS policies elsewhere
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND gm.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_owner(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND gm.status = 'active'
      AND gm.role = 'owner'
  );
$$;

-- Minimal RLS: members can read group & membership rows
DROP POLICY IF EXISTS groups_select_members ON public.groups;
CREATE POLICY groups_select_members
  ON public.groups FOR SELECT
  TO authenticated
  USING (public.is_group_member(id));

DROP POLICY IF EXISTS group_members_select_members ON public.group_members;
CREATE POLICY group_members_select_members
  ON public.group_members FOR SELECT
  TO authenticated
  USING (public.is_group_member(group_id));

-- Events
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NULL,
  status public.event_status NOT NULL DEFAULT 'open',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NULL,
  closed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_ends_at_gte_starts_at CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Event participants
CREATE TABLE IF NOT EXISTS public.event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.participant_status NOT NULL DEFAULT 'going',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_participants_event_user_unique
  ON public.event_participants (event_id, user_id);

ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;

-- Expenses
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  event_id uuid NULL REFERENCES public.events(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  paid_by_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  split_method public.split_method NOT NULL DEFAULT 'equal',
  status public.expense_status NOT NULL DEFAULT 'confirmed',
  incurred_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- Expense splits
CREATE TABLE IF NOT EXISTS public.expense_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  share_cents integer NOT NULL DEFAULT 0,
  percentage numeric NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expense_splits_expense_idx ON public.expense_splits (expense_id);

ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;

-- Invites (used by accept/create-invite)
CREATE TABLE IF NOT EXISTS public.group_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  token uuid NOT NULL,
  email text NOT NULL,
  invited_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  status public.invite_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS group_invites_token_unique ON public.group_invites (token);

ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

-- Settlements (used by dashboard/group settle up)
CREATE TABLE IF NOT EXISTS public.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  event_id uuid NULL REFERENCES public.events(id) ON DELETE SET NULL,
  from_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  to_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  settled_at timestamptz NOT NULL DEFAULT now(),
  note text NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

-- Notifications (used by payment requests and UI tray)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NULL,
  body text NULL,
  cta_label text NULL,
  cta_url text NULL,
  entity_type text NULL,
  entity_id uuid NULL,
  data jsonb NULL,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Minimal RLS for notifications: only owner can read/update
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

