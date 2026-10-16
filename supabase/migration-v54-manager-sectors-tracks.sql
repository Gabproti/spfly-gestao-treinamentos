-- V54: setor do gestor, vínculo por setor em admissões/transferências e inscrições por trilha.
-- Aplicar depois da V49, antes de publicar a interface V54.
begin;

alter table public.admin_users add column if not exists manager_sector text;

create or replace function public.hr_set_manager_sector(target_manager uuid, next_sector text)
returns void language plpgsql security definer set search_path='' as $$
declare v_sector text:=nullif(btrim(next_sector),'');
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem definir o setor do gestor' using errcode='42501'; end if;
  if not exists(select 1 from public.admin_users where id=target_manager and active and access_role='gestor') then
    raise exception 'Selecione um gestor ativo' using errcode='22023'; end if;
  if v_sector is not null and not exists(select 1 from public.portal_sectors where name=v_sector) then
    raise exception 'Setor inválido' using errcode='22023'; end if;
  update public.admin_users set manager_sector=v_sector where id=target_manager;
end;
$$;
revoke all on function public.hr_set_manager_sector(uuid,text) from public,anon;
grant execute on function public.hr_set_manager_sector(uuid,text) to authenticated;

-- Um novo funcionário ou uma mudança de setor só cria vínculo automático quando
-- há exatamente um gestor ativo no setor de destino. Caso contrário, o vínculo
-- antigo é removido e o administrador escolhe o novo gestor na tela.
create or replace function public.hr_sync_employee_manager_by_sector()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_old_sectors jsonb; v_employee jsonb; v_id text; v_sector text;
  v_manager uuid; v_count bigint;
begin
  select coalesce(jsonb_object_agg(item->>'id',nullif(btrim(item->>'sector'),'')),'{}'::jsonb)
    into v_old_sectors from jsonb_array_elements(old.employees) as e(item)
    where item->>'id' ~ '^[0-9]+$';
  for v_employee in select item from jsonb_array_elements(new.employees) as e(item) loop
    v_id:=v_employee->>'id';
    v_sector:=nullif(btrim(v_employee->>'sector'),'');
    if v_id is null or v_id !~ '^[0-9]+$' then continue; end if;
    if v_old_sectors ? v_id and (v_old_sectors->>v_id) is not distinct from v_sector then continue; end if;
    select (array_agg(id))[1],count(*) into v_manager,v_count
      from public.admin_users
      where active and access_role='gestor' and manager_sector=v_sector;
    if v_count=1 then
      insert into public.hr_manager_team(employee_id,manager_id,linked_by)
        values(v_id::bigint,v_manager,(select auth.uid()))
        on conflict(employee_id) do update set manager_id=excluded.manager_id,
          linked_at=now(),linked_by=excluded.linked_by;
    else
      delete from public.hr_manager_team where employee_id=v_id::bigint;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists hr_sync_employee_manager_sector on public.app_state;
create trigger hr_sync_employee_manager_sector
after update of employees on public.app_state
for each row when (old.employees is distinct from new.employees)
execute function public.hr_sync_employee_manager_by_sector();
revoke all on function public.hr_sync_employee_manager_by_sector() from public,anon,authenticated;

create or replace function public.hr_dashboard()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_admin boolean:=public.is_admin();
  v_result jsonb;
begin
  if not (v_admin or public.hr_is_manager()) then raise exception 'Acesso negado' using errcode='42501'; end if;
  select jsonb_build_object(
    'my_sector',(select a.manager_sector from public.admin_users a where a.id=v_actor),
    'employees',coalesce((select jsonb_agg(jsonb_build_object('id',(emp->>'id')::bigint,
      'name',emp->>'name','sector',emp->>'sector','role',emp->>'role','mat',emp->>'mat',
      'manager_id',m.manager_id) order by emp->>'name')
      from public.app_state s cross join lateral jsonb_array_elements(s.employees) as e(emp)
      left join public.hr_manager_team m on m.employee_id=(emp->>'id')::bigint
      where s.id=1 and (v_admin or m.manager_id=v_actor)),'[]'::jsonb),
    'managers',case when v_admin then coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.full_name,'sector',a.manager_sector,'supervisor_id',sp.supervisor_id) order by a.full_name)
      from public.admin_users a left join public.hr_manager_supervisors sp on sp.manager_id=a.id
      where a.active and a.access_role='gestor'),'[]'::jsonb) else '[]'::jsonb end,
    'approvers',case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.full_name,'role',a.access_role) order by a.full_name)
      from public.admin_users a where a.active and a.access_role in ('admin','gestor')),'[]'::jsonb) else '[]'::jsonb end,
    'sectors',coalesce((select jsonb_agg(name order by name) from public.portal_sectors),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,
      'requester_id',r.requester_id,'requester_name',a.full_name,'employee_id',r.employee_id,
      'current_sector',r.current_sector,'target_sector',r.target_sector,
      'position_name',r.position_name,'quantity',r.quantity,'filled_quantity',r.filled_quantity,
      'reason',r.reason,'status',r.status,'created_at',r.created_at,'updated_at',r.updated_at,
      'completed_at',r.completed_at,'immediate_approver_id',r.immediate_approver_id,
      'current_manager_id',r.current_manager_id,'current_manager_skipped',r.current_manager_skipped,
      'events',coalesce((select jsonb_agg(jsonb_build_object('action',ev.action,
        'previous_status',ev.previous_status,'next_status',ev.next_status,'note',ev.note,
        'created_at',ev.created_at,'actor_name',actor.full_name) order by ev.id)
        from public.hr_request_events ev join public.admin_users actor on actor.id=ev.actor_id
        where ev.request_id=r.id),'[]'::jsonb)) order by r.created_at desc)
      from public.hr_requests r join public.admin_users a on a.id=r.requester_id
      where v_admin or r.requester_id=v_actor or r.immediate_approver_id=v_actor
        or r.current_manager_id=v_actor),'[]'::jsonb),
    'courses',coalesce((select jsonb_agg(jsonb_build_object('course_id',c.id,'course_name',c.name,
      'track_id',t.id,'track_name',t.name,'employee_id',e.employee_id,'enrollment_id',e.id,
      'enrolled_at',e.enrolled_at,'started_at',p.started_at,'completed_at',p.completed_at,
      'course_finished_at',p.course_finished_at,'certificate_path',p.certificate_path,
      'certificate_name',p.certificate_name,'validation_status',p.validation_status,
      'track_certificate_path',e.track_certificate_path,'track_certificate_name',e.track_certificate_name)
      order by t.name,c.sort_order)
      from public.cap_enrollments e join public.cap_tracks t on t.id=e.track_id
      join public.cap_courses c on c.track_id=t.id and c.active
      left join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
      left join public.hr_manager_team m on m.employee_id=e.employee_id
      where e.removed_at is null and t.deleted_at is null
        and (v_admin or m.manager_id=v_actor)
        and (exists(select 1 from public.cap_course_grants g
          where g.employee_id=e.employee_id and g.course_id=c.id)
          or (not e.individual_only and public.cap_employee_matches_sectors(e.employee_id,t.sectors)
            and public.cap_course_matches_systems(c.id,e.employee_id))
          or p.started_at is not null or p.completed_at is not null)),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

commit;
