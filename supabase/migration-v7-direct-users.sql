-- V7: cadastro direto com senha inicial e troca obrigatória. Execute após V6.
-- As contas existentes não são afetadas.

alter table public.admin_users
  add column if not exists must_change_password boolean not null default false;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where id = (select auth.uid()) and active = true and not must_change_password and access_role = 'admin'
  );
$$;

create or replace function public.can_view_portal_page(page_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where id = (select auth.uid()) and active = true and not must_change_password
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
    where id = (select auth.uid()) and active = true and not must_change_password
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
    from public.admin_users where id = (select auth.uid()) and active = true and not must_change_password;
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


