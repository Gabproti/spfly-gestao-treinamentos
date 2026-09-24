-- Execute no SQL Editor do projeto Supabase antes de publicar a V4.
-- A primeira conta administrativa é adicionada separadamente em bootstrap-admin.sql.

create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  active boolean not null default true,
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;
grant update (full_name) on public.admin_users to authenticated;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where id = (select auth.uid()) and active = true
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy admin_users_read on public.admin_users
for select to authenticated
using (id = (select auth.uid()) or public.is_admin());

create policy admin_users_update_own_name on public.admin_users
for update to authenticated
using (id = (select auth.uid()) and active = true)
with check (id = (select auth.uid()) and active = true);

create table if not exists public.app_state (
  id integer primary key default 1 check (id = 1),
  version bigint not null default 0,
  employees jsonb not null default '[]'::jsonb check (jsonb_typeof(employees) = 'array'),
  trainings jsonb not null default '[]'::jsonb check (jsonb_typeof(trainings) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.app_state (id) values (1) on conflict (id) do nothing;
alter table public.app_state enable row level security;
revoke all on public.app_state from anon, authenticated;
grant select on public.app_state to authenticated;

create policy app_state_admin_read on public.app_state
for select to authenticated
using (public.is_admin());

-- A gravação usa versão esperada para impedir que um administrador sobrescreva
-- alterações feitas por outro administrador em uma sessão concorrente.
create or replace function public.save_app_state(
  expected_version bigint,
  next_employees jsonb,
  next_trainings jsonb
)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare new_version bigint;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if jsonb_typeof(next_employees) <> 'array'
     or jsonb_typeof(next_trainings) <> 'array' then
    raise exception 'Formato de dados inválido' using errcode = '22023';
  end if;

  update public.app_state
     set employees = next_employees,
         trainings = next_trainings,
         version = version + 1,
         updated_at = now(),
         updated_by = (select auth.uid())
   where id = 1 and version = expected_version
   returning version into new_version;

  if new_version is null then
    raise exception 'Os dados foram alterados por outro administrador. Recarregue a página.'
      using errcode = '40001';
  end if;
  return new_version;
end;
$$;

revoke all on function public.save_app_state(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.save_app_state(bigint, jsonb, jsonb) to authenticated;

-- Os anexos ficam privados. O navegador só acessa os objetos com uma sessão
-- de administrador válida e as políticas abaixo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('training-files', 'training-files', false, 10485760)
on conflict (id) do nothing;

create policy training_files_admin_read on storage.objects
for select to authenticated
using (bucket_id = 'training-files' and public.is_admin());

create policy training_files_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'training-files' and public.is_admin());

create policy training_files_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'training-files' and public.is_admin())
with check (bucket_id = 'training-files' and public.is_admin());

create policy training_files_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'training-files' and public.is_admin());
