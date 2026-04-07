-- =============================================================================
-- Reproducible E2E dataset (users A/B/C, groups, events, expenses, invite, payment request)
-- Loaded after ./seed.sql when [db.seed].sql_paths includes this file.
-- =============================================================================
-- Log in (local):
--   A: e2e-a@splitly.local  / SplitlyE2E!1
--   B: e2e-b@splitly.local  / SplitlyE2E!1
--   C: e2e-c@splitly.local  / SplitlyE2E!1
-- Invite (pending, G2): /invite/e2e00000-0000-4000-8000-0000000000e1
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = public, extensions;

-- Clean up any previous runs (idempotent seed)
DO $$
BEGIN
  -- Public tables (delete children first)
  DELETE FROM public.expense_splits WHERE expense_id IN (
    'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc03',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc04',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc05'
  );
  DELETE FROM public.expenses WHERE id IN (
    'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc03',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc04',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc05'
  );

  DELETE FROM public.event_participants WHERE event_id IN (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  );
  DELETE FROM public.events WHERE id IN (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  );

  DELETE FROM public.group_invites WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';

  DELETE FROM public.group_members WHERE group_id IN (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
  );
  DELETE FROM public.groups WHERE id IN (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
  );

  DELETE FROM public.notifications WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
END $$;

-- Fixed UUIDs (deterministic across resets)
-- Users
-- A: 11111111-1111-4111-8111-111111111101
-- B: 22222222-2222-4222-8222-222222222202
-- C: 33333333-3333-4333-8333-333333333303
-- Groups G1 / G2
-- G1: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1  (A+B)
-- G2: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2  (A+B+C)
-- Events (G2)
-- E1 draft: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1
-- E2 open:  bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2

INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token
)
VALUES
  (
    '11111111-1111-4111-8111-111111111101',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'e2e-a@splitly.local',
    extensions.crypt('SplitlyE2E!1', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '',
    ''
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'e2e-b@splitly.local',
    extensions.crypt('SplitlyE2E!1', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '',
    ''
  ),
  (
    '33333333-3333-4333-8333-333333333303',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'e2e-c@splitly.local',
    extensions.crypt('SplitlyE2E!1', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '',
    ''
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
VALUES
  (
    '21111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111101',
    'e2e-a@splitly.local',
    jsonb_build_object(
      'sub', '11111111-1111-4111-8111-111111111101',
      'email', 'e2e-a@splitly.local',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222212',
    '22222222-2222-4222-8222-222222222202',
    'e2e-b@splitly.local',
    jsonb_build_object(
      'sub', '22222222-2222-4222-8222-222222222202',
      'email', 'e2e-b@splitly.local',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now()
  ),
  (
    '23333333-3333-4333-8333-333333333313',
    '33333333-3333-4333-8333-333333333303',
    'e2e-c@splitly.local',
    jsonb_build_object(
      'sub', '33333333-3333-4333-8333-333333333303',
      'email', 'e2e-c@splitly.local',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, username, timezone, default_currency, onboarding_completed, updated_at)
VALUES
  ('11111111-1111-4111-8111-111111111101', 'E2E User A', 'e2e_user_a', 'UTC', 'EUR', true, now()),
  ('22222222-2222-4222-8222-222222222202', 'E2E User B', 'e2e_user_b', 'UTC', 'EUR', true, now()),
  ('33333333-3333-4333-8333-333333333303', 'E2E User C', 'e2e_user_c', 'UTC', 'EUR', true, now())
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  username = EXCLUDED.username,
  updated_at = now();

INSERT INTO public.groups (id, name, description, created_by, base_currency, created_at, updated_at)
VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'E2E G1 (A+B)',
    'Seed: grupo com A e B; dívida B→A via despesa confirmada.',
    '11111111-1111-4111-8111-111111111101',
    'EUR',
    now(),
    now()
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'E2E G2 (A+B+C)',
    'Seed: eventos draft/open, despesas variadas, convite pendente.',
    '11111111-1111-4111-8111-111111111101',
    'EUR',
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.group_members (group_id, user_id, role, status, joined_at, created_at)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111101', 'owner', 'active', now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '22222222-2222-4222-8222-222222222202', 'member', 'active', now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111101', 'owner', 'active', now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '22222222-2222-4222-8222-222222222202', 'member', 'active', now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '33333333-3333-4333-8333-333333333303', 'member', 'active', now(), now());

INSERT INTO public.events (
  id,
  group_id,
  created_by,
  title,
  description,
  status,
  starts_at,
  ends_at,
  created_at,
  updated_at
)
VALUES
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '11111111-1111-4111-8111-111111111101',
    'E2E Draft Event',
    'Seed evento em draft',
    'draft',
    (now() + interval '2 days'),
    (now() + interval '5 days'),
    now(),
    now()
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '11111111-1111-4111-8111-111111111101',
    'E2E Open Event',
    'Seed evento open',
    'open',
    (now() - interval '1 day'),
    (now() + interval '14 days'),
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_participants (event_id, user_id, status, created_at)
VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '11111111-1111-4111-8111-111111111101', 'going', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '22222222-2222-4222-8222-222222222202', 'going', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '33333333-3333-4333-8333-333333333303', 'going', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '11111111-1111-4111-8111-111111111101', 'going', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222202', 'going', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '33333333-3333-4333-8333-333333333303', 'going', now());

-- Expenses (ids fixed for reference in tests)
-- 1) G1: dívida prévia B→A — A pagou 100€, split 50/50 → B deve 50€ a A
INSERT INTO public.expenses (
  id,
  group_id,
  event_id,
  title,
  description,
  amount_cents,
  currency,
  paid_by_user_id,
  created_by,
  split_method,
  status,
  incurred_at,
  created_at,
  updated_at
)
VALUES
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    NULL,
    'E2E G1 jantar (dívida B→A)',
    'A pagou; split igual — B deve metade a A.',
    10000,
    'EUR',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111101',
    'equal',
    'confirmed',
    now() - interval '3 days',
    now(),
    now()
  ),
  -- 2) G2: rascunho sem evento
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    NULL,
    'E2E rascunho (só grupo)',
    NULL,
    2500,
    'EUR',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111101',
    'equal',
    'draft',
    now(),
    now(),
    now()
  ),
  -- 3) G2: confirmado sem evento
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccc03',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    NULL,
    'E2E confirmado (só grupo)',
    NULL,
    4000,
    'EUR',
    '22222222-2222-4222-8222-222222222202',
    '22222222-2222-4222-8222-222222222202',
    'equal',
    'confirmed',
    now() - interval '1 day',
    now(),
    now()
  ),
  -- 4) G2: rascunho no evento E1 (draft)
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccc04',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'E2E rascunho em evento draft',
    NULL,
    1500,
    'EUR',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111101',
    'equal',
    'draft',
    now(),
    now(),
    now()
  ),
  -- 5) G2: confirmado no evento E2 (open)
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccc05',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'E2E confirmado em evento open',
    NULL,
    8000,
    'EUR',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111101',
    'equal',
    'confirmed',
    now() - interval '12 hours',
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

-- Splits: equal among participants (manual rows for determinism)
INSERT INTO public.expense_splits (expense_id, user_id, share_cents, percentage, created_at)
VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc01', '11111111-1111-4111-8111-111111111101', 5000, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc01', '22222222-2222-4222-8222-222222222202', 5000, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc02', '11111111-1111-4111-8111-111111111101', 834, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc02', '22222222-2222-4222-8222-222222222202', 833, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc02', '33333333-3333-4333-8333-333333333303', 833, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc03', '11111111-1111-4111-8111-111111111101', 1334, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc03', '22222222-2222-4222-8222-222222222202', 1333, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc03', '33333333-3333-4333-8333-333333333303', 1333, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc04', '11111111-1111-4111-8111-111111111101', 500, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc04', '22222222-2222-4222-8222-222222222202', 500, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc04', '33333333-3333-4333-8333-333333333303', 500, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc05', '11111111-1111-4111-8111-111111111101', 2667, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc05', '22222222-2222-4222-8222-222222222202', 2667, NULL, now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc05', '33333333-3333-4333-8333-333333333303', 2666, NULL, now());

-- Convite pendente (G2), token fixo para URL /invite/:token
INSERT INTO public.group_invites (
  id,
  group_id,
  token,
  email,
  invited_by,
  expires_at,
  status,
  created_at
)
VALUES (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'e2e00000-0000-4000-8000-0000000000e1',
  'e2e-pending-invite@splitly.local',
  '11111111-1111-4111-8111-111111111101',
  (now() + interval '30 days'),
  'pending',
  now()
)
ON CONFLICT (id) DO NOTHING;

-- Pedido de pagamento: notificação para A (alvo), pedido criado por B no G1
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (
    id,
    user_id,
    type,
    title,
    body,
    cta_label,
    cta_url,
    entity_type,
    entity_id,
    data,
    is_read,
    read_at,
    created_at
  )
  VALUES (
    'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    '11111111-1111-4111-8111-111111111101',
    'payment_request',
    'E2E: User B requested €25.00',
    'Related to the group "E2E G1 (A+B)"',
    'View group',
    '/groups/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'group',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    jsonb_build_object(
      'requester_user_id', '22222222-2222-4222-8222-222222222202',
      'requester_name', 'E2E User B',
      'target_user_id', '11111111-1111-4111-8111-111111111101',
      'group_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'group_name', 'E2E G1 (A+B)',
      'amount_cents', 2500,
      'currency', 'EUR'
    ),
    false,
    NULL,
    now()
  )
  ON CONFLICT (id) DO NOTHING;
END $$;

SELECT 1;
