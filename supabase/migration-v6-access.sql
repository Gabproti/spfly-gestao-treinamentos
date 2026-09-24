-- V6: perfis e permissões por tela. Execute uma vez antes de publicar auth.js.
-- As contas existentes continuam como administradores.

alter table public.admin_users
  add column if not exists access_role text not null default 'admin',
  add column if not exists allowed_pages text[] not null default '{}'::text[];

alter table public.admin_users
  add constraint admin_users_access_role_check check (access_role in ('admin','rh','usuario')),
  add constraint admin_users_allowed_pages_check check (allowed_pages <@ array['dashboard','employees','trainings','reports']::text[]);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where id = (select auth.uid()) and active = true and access_role = 'admin'
  );
$$;

create or replace function public.can_view_portal_page(page_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where id = (select auth.uid()) and active = true
      and (
        access_role = 'admin'
        or (access_role = 'rh' and page_name in ('employees','trainings'))
        or (access_role = 'usuario' and page_name = any(allowed_pages))
      )
  );
$$;

create or replace function public.can_edit_portal_data(data_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where id = (select auth.uid()) and active = true
      and (
        (access_role in ('admin','rh') and data_name in ('employees','trainings'))
        or (access_role = 'usuario' and data_name in ('employees','trainings') and data_name = any(allowed_pages))
      )
  );
$$;

revoke all on function public.can_view_portal_page(text) from public, anon;
revoke all on function public.can_edit_portal_data(text) from public, anon;
grant execute on function public.can_view_portal_page(text) to authenticated;
grant execute on function public.can_edit_portal_data(text) to authenticated;

-- A página inicial isolada recebe apenas os campos necessários à agenda.
create or replace function public.load_portal_state()
returns table(version bigint, employees jsonb, trainings jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_pages text[];
  v_employees jsonb;
  v_trainings jsonb;
  v_version bigint;
begin
  select access_role, allowed_pages into v_role, v_pages
    from public.admin_users where id = (select auth.uid()) and active = true;
  if v_role is null then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select s.version, s.employees, s.trainings into v_version, v_employees, v_trainings
    from public.app_state s where s.id = 1;

  version := v_version;
  if v_role in ('admin','rh') or 'reports' = any(v_pages)
     or ('employees' = any(v_pages) and 'trainings' = any(v_pages)) then
    employees := v_employees;
    trainings := v_trainings;
  elsif 'employees' = any(v_pages) then
    employees := v_employees;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', item->'id', 'date', item->'date', 'name', item->'name',
      'participants', coalesce(item->'participants','[]'::jsonb)
    )), '[]'::jsonb) into trainings
    from jsonb_array_elements(v_trainings) as t(item);
  elsif 'trainings' = any(v_pages) then
    trainings := v_trainings;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', item->'id', 'mat', item->'mat', 'name', item->'name',
      'sector', item->'sector', 'role', item->'role', 'status', item->'status'
    )), '[]'::jsonb) into employees
    from jsonb_array_elements(v_employees) as t(item);
  elsif 'dashboard' = any(v_pages) then
    employees := '[]'::jsonb;
    select coalesce(jsonb_agg(
      (item - 'participants' - 'docs' - 'doc' - 'docFiles' - 'contentDocs'
            - 'contentDoc' - 'contentFiles' - 'docData' - 'contentData'
            - 'obs' - 'desc' - 'resp' - 'cancelReason' - 'statusChanges')
      || jsonb_build_object('participantCount', jsonb_array_length(coalesce(item->'participants','[]'::jsonb)))
    ), '[]'::jsonb) into trainings
    from jsonb_array_elements(v_trainings) as t(item);
  else
    employees := '[]'::jsonb;
    trainings := '[]'::jsonb;
  end if;
  return next;
end;
$$;

revoke all on function public.load_portal_state() from public, anon;
grant execute on function public.load_portal_state() to authenticated;

create or replace function public.save_app_state(
  expected_version bigint, next_employees jsonb, next_trainings jsonb
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  current_employees jsonb;
  current_trainings jsonb;
  current_version bigint;
  new_version bigint;
begin
  if not public.can_edit_portal_data('employees') and not public.can_edit_portal_data('trainings') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if jsonb_typeof(next_employees) <> 'array' or jsonb_typeof(next_trainings) <> 'array' then
    raise exception 'Formato de dados inválido' using errcode = '22023';
  end if;

  select s.version, s.employees, s.trainings into current_version, current_employees, current_trainings
    from public.app_state s where s.id = 1 for update;
  if current_version <> expected_version then
    raise exception 'Os dados foram alterados por outra pessoa. Recarregue a página.' using errcode = '40001';
  end if;
  if not public.can_edit_portal_data('employees') then next_employees := current_employees; end if;
  if not public.can_edit_portal_data('trainings') then next_trainings := current_trainings; end if;

  update public.app_state
     set employees = next_employees, trainings = next_trainings,
         version = version + 1, updated_at = now(), updated_by = (select auth.uid())
   where id = 1 returning app_state.version into new_version;
  return new_version;
end;
$$;

-- O administrador pode ajustar perfis convidados sem expor uma chave secreta ao navegador.
create or replace function public.set_portal_access(target_id uuid, next_role text, next_pages text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Somente administradores podem alterar acessos' using errcode = '42501'; end if;
  if target_id = (select auth.uid()) then raise exception 'Não altere o próprio perfil' using errcode = '42501'; end if;
  if next_role not in ('admin','rh','usuario') then raise exception 'Perfil inválido' using errcode = '22023'; end if;
  if next_pages is null or not (next_pages <@ array['dashboard','employees','trainings','reports']::text[]) then
    raise exception 'Telas inválidas' using errcode = '22023';
  end if;
  if next_role = 'usuario' and cardinality(next_pages) = 0 then
    raise exception 'Escolha ao menos uma tela' using errcode = '22023';
  end if;
  update public.admin_users
     set access_role = next_role,
         allowed_pages = case when next_role = 'usuario' then next_pages else '{}'::text[] end
   where id = target_id and active = true;
  if not found then raise exception 'Conta não encontrada' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.set_portal_access(uuid,text,text[]) from public, anon;
grant execute on function public.set_portal_access(uuid,text,text[]) to authenticated;

-- Políticas antigas continuam exigindo admin; estas liberam anexos apenas a quem
-- pode consultar ou editar treinamentos.
create policy training_files_member_read on storage.objects
for select to authenticated
using (bucket_id = 'training-files' and (public.can_view_portal_page('trainings') or public.can_view_portal_page('reports')));

create policy training_files_member_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'training-files' and public.can_edit_portal_data('trainings'));

create policy training_files_member_update on storage.objects
for update to authenticated
using (bucket_id = 'training-files' and public.can_edit_portal_data('trainings'))
with check (bucket_id = 'training-files' and public.can_edit_portal_data('trainings'));

create policy training_files_member_delete on storage.objects
for delete to authenticated
using (bucket_id = 'training-files' and public.can_edit_portal_data('trainings'));
