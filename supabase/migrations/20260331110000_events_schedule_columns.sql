alter table public.events
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz;

update public.events
set starts_at = created_at
where starts_at is null;

alter table public.events
  alter column starts_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_ends_at_gte_starts_at'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_ends_at_gte_starts_at
      check (ends_at is null or ends_at >= starts_at);
  end if;
end $$;
