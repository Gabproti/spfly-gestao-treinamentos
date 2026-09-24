-- Execute uma vez no SQL Editor do projeto existente antes de publicar a V5.
-- Permite que cada administrador ativo cadastre e altere apenas o próprio nome.

alter table public.admin_users add column if not exists full_name text;
grant update (full_name) on public.admin_users to authenticated;

create policy admin_users_update_own_name on public.admin_users
for update to authenticated
using (id = (select auth.uid()) and active = true)
with check (id = (select auth.uid()) and active = true);
