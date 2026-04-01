do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'expense_status'
  ) then
    create type public.expense_status as enum ('draft', 'confirmed');
  end if;
end $$;

alter table public.expenses
  add column if not exists status public.expense_status;

update public.expenses
set status = 'confirmed'
where status is null;

alter table public.expenses
  alter column status set default 'confirmed',
  alter column status set not null;
