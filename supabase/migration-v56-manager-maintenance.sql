-- V56: manutenção de gestores e vínculo em lote dos funcionários do setor.
-- Aplicar após a V55. A exclusão do gestor é lógica para preservar solicitações históricas.
begin;

create or replace function public.hr_reconcile_sector_team_v56(target_sector text, preferred_manager uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare v_manager uuid:=preferred_manager; v_count bigint; v_total integer;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem alterar equipes' using errcode='42501';
  end if;
  if target_sector is null then return 0; end if;
  if v_manager is not null and not exists(
    select 1 from public.admin_users a where a.id=v_manager and a.active
      and a.access_role='gestor' and a.manager_sector=target_sector) then
    raise exception 'Gestor não pertence ao setor' using errcode='22023';
  end if;
  if v_manager is null then
    select d.manager_id into v_manager from public.hr_sector_manager_defaults d
      join public.admin_users a on a.id=d.manager_id
      where d.sector=target_sector and a.active and a.access_role='gestor'
        and a.manager_sector=target_sector;
  end if;
  if v_manager is null then
    select (array_agg(a.id))[1],count(*) into v_manager,v_count
      from public.admin_users a where a.active and a.access_role='gestor'
        and a.manager_sector=target_sector;
    if v_count<>1 then v_manager:=null; end if;
  end if;

  -- Um único vínculo por funcionário. Reatribui inclusive quem já tinha outro gestor.
  with members as (
    select distinct (e.item->>'id')::bigint as employee_id
    from public.app_state s cross join lateral jsonb_array_elements(s.employees) e(item)
    where s.id=1 and e.item->>'id' ~ '^[0-9]+$'
      and lower(btrim(e.item->>'sector'))=lower(target_sector)
  )
  select count(*) into v_total from members;

  delete from public.hr_manager_team t where exists (
    select 1 from public.app_state s cross join lateral jsonb_array_elements(s.employees) e(item)
    where s.id=1 and e.item->>'id' ~ '^[0-9]+$'
      and (e.item->>'id')::bigint=t.employee_id
      and lower(btrim(e.item->>'sector'))=lower(target_sector)
  ) and (v_manager is null or t.manager_id<>v_manager);

  if v_manager is not null then
    insert into public.hr_manager_team(employee_id,manager_id,linked_by)
    select distinct (e.item->>'id')::bigint,v_manager,(select auth.uid())
    from public.app_state s cross join lateral jsonb_array_elements(s.employees) e(item)
    where s.id=1 and e.item->>'id' ~ '^[0-9]+$'
      and lower(btrim(e.item->>'sector'))=lower(target_sector)
    on conflict(employee_id) do update set manager_id=excluded.manager_id,
      linked_at=now(),linked_by=excluded.linked_by
      where public.hr_manager_team.manager_id is distinct from excluded.manager_id;
  end if;
  return v_total;
end;
$$;
revoke all on function public.hr_reconcile_sector_team_v56(text,uuid) from public,anon,authenticated;

create or replace function public.hr_update_manager_v56(target_manager uuid,next_name text,next_sector text)
returns integer language plpgsql security definer set search_path='' as $$
declare v_old_sector text; v_sector text:=nullif(btrim(next_sector),'');
  v_name text:=nullif(btrim(next_name),''); v_total integer:=0;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem editar gestores' using errcode='42501';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 160 then
    raise exception 'Informe o nome do gestor (2 a 160 caracteres)' using errcode='22023';
  end if;
  if v_sector is not null and not exists(select 1 from public.portal_sectors s where s.name=v_sector) then
    raise exception 'Setor não cadastrado' using errcode='22023';
  end if;
  select a.manager_sector into v_old_sector from public.admin_users a
    where a.id=target_manager and a.active and a.access_role='gestor' for update;
  if not found then raise exception 'Gestor ativo não encontrado' using errcode='22023'; end if;

  update public.admin_users a set full_name=v_name,manager_sector=v_sector where a.id=target_manager;
  if v_sector is not null then
    insert into public.hr_sector_manager_defaults(sector,manager_id,updated_at,updated_by)
    values(v_sector,target_manager,now(),(select auth.uid()))
    on conflict(sector) do update set manager_id=excluded.manager_id,
      updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  end if;
  if v_old_sector is distinct from v_sector and v_old_sector is not null then
    perform public.hr_reconcile_sector_team_v56(v_old_sector,null);
  end if;
  if v_sector is not null then
    v_total:=public.hr_reconcile_sector_team_v56(v_sector,target_manager);
  end if;
  return v_total;
end;
$$;
revoke all on function public.hr_update_manager_v56(uuid,text,text) from public,anon;
grant execute on function public.hr_update_manager_v56(uuid,text,text) to authenticated;

create or replace function public.hr_archive_manager_v56(target_manager uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_sector text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem excluir gestores' using errcode='42501';
  end if;
  select a.manager_sector into v_sector from public.admin_users a
    where a.id=target_manager and a.active and a.access_role='gestor' for update;
  if not found then raise exception 'Gestor ativo não encontrado' using errcode='22023'; end if;
  if exists(select 1 from public.hr_requests r
    where (r.requester_id=target_manager or r.immediate_approver_id=target_manager
      or r.current_manager_id=target_manager)
      and r.status not in ('completed','rejected','cancelled')) then
    raise exception 'Conclua ou transfira as solicitações pendentes antes de excluir este gestor' using errcode='23514';
  end if;
  update public.admin_users a set active=false where a.id=target_manager;
  delete from public.hr_manager_supervisors s
    where s.manager_id=target_manager or s.supervisor_id=target_manager;
  delete from public.hr_manager_team t where t.manager_id=target_manager;
  if v_sector is not null then perform public.hr_reconcile_sector_team_v56(v_sector,null); end if;
end;
$$;
revoke all on function public.hr_archive_manager_v56(uuid) from public,anon;
grant execute on function public.hr_archive_manager_v56(uuid) to authenticated;

-- A escolha do responsável por setor também atualiza os funcionários já cadastrados.
create or replace function public.hr_set_sector_manager_v55(target_sector text,target_manager uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem definir o gestor do setor' using errcode='42501'; end if;
  if not exists(select 1 from public.portal_sectors where name=target_sector) then
    raise exception 'Setor não cadastrado' using errcode='22023'; end if;
  if target_manager is null then
    delete from public.hr_sector_manager_defaults where sector=target_sector;
  else
    if not exists(select 1 from public.admin_users
      where id=target_manager and active and access_role='gestor' and manager_sector=target_sector) then
      raise exception 'Selecione um gestor ativo vinculado ao setor' using errcode='22023'; end if;
    insert into public.hr_sector_manager_defaults(sector,manager_id,updated_at,updated_by)
      values(target_sector,target_manager,now(),(select auth.uid()))
      on conflict(sector) do update set manager_id=excluded.manager_id,
        updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  end if;
  perform public.hr_reconcile_sector_team_v56(target_sector,target_manager);
end;
$$;

commit;
