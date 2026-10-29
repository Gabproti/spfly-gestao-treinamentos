-- V55: solicitações de vagas, transferência/promoção, gestor por setor e emissão RH.
-- Preparada para revisão local. Aplicar apenas após aprovação e antes de publicar a interface.
begin;

alter table public.hr_requests
  add column if not exists request_type text,
  add column if not exists work_days text,
  add column if not exists work_schedule text,
  add column if not exists requester_sector text,
  add column if not exists destination_position text;
alter table public.hr_requests drop constraint if exists hr_requests_request_type_v55;
alter table public.hr_requests add constraint hr_requests_request_type_v55
  check (request_type is null or request_type in ('Aumento de quadro','Substituição'));
alter table public.hr_requests drop constraint if exists hr_requests_schedule_v55;
alter table public.hr_requests add constraint hr_requests_schedule_v55
  check (work_schedule is null or work_schedule ~ '^([01][0-9]|2[0-3]):[0-5][0-9] às ([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.hr_requests drop constraint if exists hr_requests_days_v55;
alter table public.hr_requests add constraint hr_requests_days_v55
  check (work_days is null or char_length(btrim(work_days)) between 3 and 80);
alter table public.hr_requests drop constraint if exists hr_requests_destination_position_v55;
alter table public.hr_requests add constraint hr_requests_destination_position_v55
  check (destination_position is null or char_length(btrim(destination_position)) between 2 and 160);
update public.hr_requests r set requester_sector=a.manager_sector
  from public.admin_users a where a.id=r.requester_id and r.requester_sector is null;

create table if not exists public.hr_sector_manager_defaults (
  sector text primary key references public.portal_sectors(name) on update cascade on delete cascade,
  manager_id uuid not null references public.admin_users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index if not exists hr_sector_manager_defaults_manager_idx
  on public.hr_sector_manager_defaults(manager_id);
alter table public.hr_sector_manager_defaults enable row level security;
revoke all on public.hr_sector_manager_defaults from public,anon,authenticated;
insert into public.hr_sector_manager_defaults(sector,manager_id)
  select manager_sector,(array_agg(id))[1] from public.admin_users
  where active and access_role='gestor' and manager_sector is not null
  group by manager_sector having count(*)=1
  on conflict(sector) do nothing;

create or replace function public.hr_set_sector_manager_v55(target_sector text,target_manager uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem definir o gestor do setor' using errcode='42501'; end if;
  if not exists(select 1 from public.portal_sectors where name=target_sector) then
    raise exception 'Setor não cadastrado' using errcode='22023'; end if;
  if target_manager is null then
    delete from public.hr_sector_manager_defaults where sector=target_sector;
    return;
  end if;
  if not exists(select 1 from public.admin_users
    where id=target_manager and active and access_role='gestor' and manager_sector=target_sector) then
    raise exception 'Selecione um gestor ativo vinculado ao setor' using errcode='22023'; end if;
  insert into public.hr_sector_manager_defaults(sector,manager_id,updated_at,updated_by)
    values(target_sector,target_manager,now(),(select auth.uid()))
    on conflict(sector) do update set manager_id=excluded.manager_id,
      updated_at=excluded.updated_at,updated_by=excluded.updated_by;
end;
$$;

create or replace function public.hr_clear_invalid_sector_default_v55()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.hr_sector_manager_defaults d where d.manager_id=new.id
    and (not new.active or new.access_role<>'gestor' or new.manager_sector is distinct from d.sector);
  return new;
end;
$$;
drop trigger if exists hr_clear_invalid_sector_default_v55 on public.admin_users;
create trigger hr_clear_invalid_sector_default_v55
after update of manager_sector,active,access_role on public.admin_users
for each row execute function public.hr_clear_invalid_sector_default_v55();
revoke all on function public.hr_clear_invalid_sector_default_v55() from public,anon,authenticated;

create or replace function public.hr_import_sector_catalog_v55()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.can_edit_portal_data('employees') then
    raise exception 'Acesso negado' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('sector',x.sector,'manager_id',x.manager_id,
    'manager_name',m.full_name) order by x.sector),'[]'::jsonb) into result
  from (
    select s.name as sector,
      coalesce(dm.id,case when count(a.id)=1 then (array_agg(a.id))[1] end) as manager_id
    from public.portal_sectors s
    left join public.hr_sector_manager_defaults d on d.sector=s.name
    left join public.admin_users dm on dm.id=d.manager_id and dm.active
      and dm.access_role='gestor' and dm.manager_sector=s.name
    left join public.admin_users a on a.active and a.access_role='gestor' and a.manager_sector=s.name
    group by s.name,dm.id
  ) x left join public.admin_users m on m.id=x.manager_id;
  return result;
end;
$$;
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
    select d.manager_id into v_manager from public.hr_sector_manager_defaults d
      join public.admin_users a on a.id=d.manager_id
      where d.sector=v_sector and a.active and a.access_role='gestor'
        and a.manager_sector=v_sector;
    if v_manager is null then
      select (array_agg(id))[1],count(*) into v_manager,v_count
        from public.admin_users
        where active and access_role='gestor' and manager_sector=v_sector;
    else v_count:=1; end if;
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

create or replace function public.hr_submit_request_v55(next_kind text,target_employee bigint,
  next_sector text,next_position text,next_quantity integer,next_reason text,
  next_request_type text,next_work_days text,next_work_schedule text)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_id bigint; v_employee jsonb; v_current_manager uuid; v_supervisor uuid;
  v_sector text; v_position text; v_destination text; v_requester_sector text;
begin
  if not (public.is_admin() or public.hr_is_manager()) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if next_kind not in ('hire','transfer') or char_length(btrim(coalesce(next_reason,''))) not between 8 and 4000
    or char_length(btrim(coalesce(next_sector,''))) not between 2 and 120 then
    raise exception 'Preencha os dados obrigatórios' using errcode='22023'; end if;
  if not exists(select 1 from public.portal_sectors where name=btrim(next_sector)) then
    raise exception 'Selecione um setor cadastrado' using errcode='22023'; end if;
  if next_kind='transfer' then
    if not public.hr_can_see_employee(target_employee) then raise exception 'Funcionário fora da sua equipe' using errcode='42501'; end if;
    select emp into v_employee from public.app_state s,
      lateral jsonb_array_elements(s.employees) as e(emp)
      where s.id=1 and (emp->>'id')::bigint=target_employee;
    if v_employee is null then raise exception 'Funcionário não encontrado' using errcode='22023'; end if;
    if v_employee->>'status'='Inativo' then raise exception 'Funcionário inativo' using errcode='22023'; end if;
    v_sector:=v_employee->>'sector';
    v_position:=coalesce(nullif(v_employee->>'role',''),'Não informado');
    v_destination:=btrim(coalesce(next_position,''));
    if char_length(v_destination) not between 2 and 160 then
      raise exception 'Informe o cargo de destino' using errcode='22023'; end if;
    if lower(btrim(v_sector))=lower(btrim(next_sector)) and lower(btrim(v_position))=lower(v_destination) then
      raise exception 'Altere o setor ou o cargo de destino' using errcode='22023'; end if;
    if exists(select 1 from public.hr_requests where kind='transfer' and employee_id=target_employee
      and status not in ('completed','rejected','cancelled')) then
      raise exception 'Já existe transferência em andamento para este funcionário' using errcode='22023'; end if;
    select manager_id into v_current_manager from public.hr_manager_team where employee_id=target_employee;
    next_quantity:=1;
  else
    if char_length(btrim(coalesce(next_position,''))) not between 2 and 160
      or next_quantity not between 1 and 1000 then raise exception 'Informe cargo e quantidade de vagas' using errcode='22023'; end if;
    if next_request_type not in ('Aumento de quadro','Substituição') then
      raise exception 'Selecione o tipo da solicitação' using errcode='22023'; end if;
    if char_length(btrim(coalesce(next_work_days,''))) not between 3 and 80 then
      raise exception 'Informe os dias de trabalho' using errcode='22023'; end if;
    if coalesce(next_work_schedule,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9] às ([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Informe o horário no formato 08:00 às 17:00' using errcode='22023'; end if;
    target_employee:=null; v_position:=btrim(next_position);
  end if;
  select coalesce(manager_sector,btrim(next_sector)) into v_requester_sector from public.admin_users
    where id=(select auth.uid());
  select supervisor_id into v_supervisor from public.hr_manager_supervisors
    where manager_id=(select auth.uid());
  insert into public.hr_requests(kind,requester_id,employee_id,current_sector,target_sector,
    position_name,quantity,reason,immediate_approver_id,current_manager_id,current_manager_skipped,
    request_type,work_days,work_schedule,requester_sector,destination_position)
    values(next_kind,(select auth.uid()),target_employee,v_sector,btrim(next_sector),v_position,
      next_quantity,btrim(next_reason),v_supervisor,v_current_manager,
      next_kind='transfer' and (v_current_manager is null or v_current_manager=(select auth.uid())),
      case when next_kind='hire' then next_request_type end,
      case when next_kind='hire' then btrim(next_work_days) end,
      case when next_kind='hire' then btrim(next_work_schedule) end,
      v_requester_sector,case when next_kind='transfer' then v_destination end)
    returning id into v_id;
  insert into public.hr_request_events(request_id,actor_id,action,next_status,note)
    values(v_id,(select auth.uid()),'requested','requested',btrim(next_reason));
  return v_id;
end;
$$;

create or replace function public.hr_advance_request(target_request bigint,next_action text,
  action_note text default null,next_filled integer default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.hr_requests%rowtype; v_next text; v_actor uuid:=(select auth.uid());
  v_admin boolean:=public.is_admin(); v_supervisor boolean; v_current boolean;
  v_new_filled integer; v_count integer;
begin
  if not (v_admin or public.hr_is_manager()) then raise exception 'Acesso negado' using errcode='42501'; end if;
  select * into r from public.hr_requests where id=target_request for update;
  if not found then raise exception 'Solicitação não encontrada' using errcode='P0002'; end if;
  v_supervisor:=v_actor=r.immediate_approver_id;
  v_current:=v_actor=r.current_manager_id;
  if next_action in ('reject','cancel') then
    if char_length(btrim(coalesce(action_note,'')))<8 then raise exception 'Informe a justificativa (mínimo 8 caracteres)' using errcode='22023'; end if;
    if r.status in ('completed','rejected','cancelled') then raise exception 'Solicitação encerrada' using errcode='22023'; end if;
    if next_action='cancel' and not (v_admin or v_actor=r.requester_id) then raise exception 'Acesso negado' using errcode='42501'; end if;
    if next_action='reject' and not (v_admin or
      (r.kind='transfer' and r.status='requested' and v_supervisor) or
      (r.kind='transfer' and r.status='immediate_approved' and v_current)) then
      raise exception 'Aprovação não atribuída a você' using errcode='42501'; end if;
    v_next:=case when next_action='cancel' then 'cancelled' else 'rejected' end;
  elsif r.kind='hire' then
    if not v_admin then raise exception 'Etapa reservada ao administrador' using errcode='42501'; end if;
    if r.status='requested' and next_action='approve' then v_next:='approved';
    elsif r.status='approved' and next_action='start_selection' then v_next:='selecting';
    elsif r.status='selecting' and next_action='record_hires' then
      v_new_filled:=coalesce(next_filled,-1);
      if v_new_filled<=r.filled_quantity or v_new_filled>r.quantity then
        raise exception 'Informe quantidade preenchida maior que a atual e até o total solicitado' using errcode='22023'; end if;
      v_next:=case when v_new_filled=r.quantity then 'completed' else 'selecting' end;
    else raise exception 'Etapa fora de sequência' using errcode='22023'; end if;
  else
    if r.status='requested' and next_action='approve_immediate' and
       (v_admin and r.immediate_approver_id is null or v_supervisor) then
      v_next:=case when r.current_manager_skipped then 'manager_accepted' else 'immediate_approved' end;
    elsif r.status='immediate_approved' and next_action='accept_manager' and (v_current or v_admin) then
      v_next:='manager_accepted';
    elsif r.status='manager_accepted' and next_action='approve_final' and v_admin then
      -- A mudança do setor é atômica com a aprovação final.
      update public.app_state s set employees=(
        select coalesce(jsonb_agg(case when (item->>'id')::bigint=r.employee_id
          then case when r.destination_position is null
            then jsonb_set(item,'{sector}',to_jsonb(r.target_sector),true)
            else jsonb_set(jsonb_set(item,'{sector}',to_jsonb(r.target_sector),true),
              '{role}',to_jsonb(r.destination_position),true) end
          else item end order by ord),'[]'::jsonb)
        from jsonb_array_elements(s.employees) with ordinality as e(item,ord)),
        version=version+1,updated_at=now(),updated_by=v_actor
        where s.id=1 and exists(select 1 from jsonb_array_elements(s.employees) as e(item)
          where (item->>'id')::bigint=r.employee_id and item->>'sector'=r.current_sector
            and (r.destination_position is null or coalesce(nullif(item->>'role',''),'Não informado')=r.position_name));
      get diagnostics v_count=row_count;
      if v_count<>1 then raise exception 'O setor do funcionário mudou. Revise a solicitação.' using errcode='40001'; end if;
      v_next:='completed';
    else raise exception 'Etapa fora de sequência ou sem permissão' using errcode='42501'; end if;
  end if;
  update public.hr_requests set status=v_next,updated_at=now(),
    filled_quantity=coalesce(v_new_filled,filled_quantity),
    completed_at=case when v_next='completed' then now() else completed_at end
    where id=r.id;
  insert into public.hr_request_events(request_id,actor_id,action,previous_status,next_status,note)
    values(r.id,v_actor,next_action,r.status,v_next,nullif(btrim(action_note),''));
  if r.kind='transfer' and r.status='requested' and v_next='manager_accepted' then
    insert into public.hr_request_events(request_id,actor_id,action,previous_status,next_status,note)
      values(r.id,v_actor,'manager_step_skipped','immediate_approved',v_next,
        'Aceite repetido dispensado: solicitante é o gestor atual ou não há gestor vinculado.');
  end if;
end;
$$;

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
    'sector_managers',case when v_admin then coalesce((select jsonb_agg(
      jsonb_build_object('sector',d.sector,'manager_id',d.manager_id) order by d.sector)
      from public.hr_sector_manager_defaults d),'[]'::jsonb) else '[]'::jsonb end,
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,
      'requester_id',r.requester_id,'requester_name',a.full_name,'employee_id',r.employee_id,
      'current_sector',r.current_sector,'target_sector',r.target_sector,
      'position_name',r.position_name,'quantity',r.quantity,'filled_quantity',r.filled_quantity,
      'reason',r.reason,'request_type',r.request_type,'work_days',r.work_days,'work_schedule',r.work_schedule,
      'requester_sector',r.requester_sector,'destination_position',r.destination_position,
      'status',r.status,'created_at',r.created_at,'updated_at',r.updated_at,
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

create or replace function public.cap_issue_official_certificate_v49(target_enrollment uuid,admin_override boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.cap_enrollments%rowtype; t public.cap_tracks%rowtype;
  employee_record jsonb; course_rows jsonb; missing_count integer; required_count integer;
  certificate_completion_at timestamptz; total_minutes bigint; issued public.cap_official_certificates%rowtype;
begin
  admin_override := coalesce(admin_override,false);
  select * into e from public.cap_enrollments where id=target_enrollment and removed_at is null for update;
  if not found then raise exception 'Inscrição não encontrada' using errcode='P0002'; end if;
  if not public.is_admin() then
    raise exception 'Somente o RH (administrador) pode emitir certificados oficiais' using errcode='42501'; end if;
  if admin_override and not public.cap_is_manager() then
    raise exception 'Somente administradores podem dispensar o tempo mínimo' using errcode='42501'; end if;
  select * into t from public.cap_tracks where id=e.track_id and deleted_at is null;
  if not found or not t.official_certificate_enabled then
    raise exception 'Certificado oficial não habilitado nesta trilha' using errcode='22023'; end if;
  select * into issued from public.cap_official_certificates
    where enrollment_id=e.id and status='valid' for update;
  if found then return to_jsonb(issued); end if;
  if not public.cap_is_manager() and exists(
    select 1 from public.cap_official_certificates
      where enrollment_id=e.id and status='invalidated') then
    raise exception 'Certificado invalidado; procure o administrador para nova emissão' using errcode='42501';
  end if;
  select item into employee_record from public.app_state s
    cross join lateral jsonb_array_elements(s.employees) as people(item)
    where s.id=1 and item->>'id'=e.employee_id::text limit 1;
  if employee_record is null or coalesce(employee_record->>'name','')='' then
    raise exception 'Cadastro do funcionário não encontrado' using errcode='22023'; end if;
  with scoped as (
    select c.*,p.completed_at,p.study_seconds from public.cap_courses c
      left join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
      where c.track_id=t.id and c.active and
        (exists(select 1 from public.cap_course_grants g
          where g.course_id=c.id and g.employee_id=e.employee_id)
          or (not e.individual_only and public.cap_employee_matches_sectors(e.employee_id,t.sectors)
            and public.cap_course_matches_systems(c.id,e.employee_id)))
  )
  select count(*) filter(where required_for_official_certificate),
    count(*) filter(where required_for_official_certificate and
      (scoped.completed_at is null or (not admin_override and
        (min_study_minutes is null or study_seconds < min_study_minutes::bigint*60)))),
    max(scoped.completed_at) filter(where required_for_official_certificate),
    coalesce(sum(duration_minutes) filter(where scoped.completed_at is not null),0),
    coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'duration_minutes',duration_minutes,
      'min_study_minutes',min_study_minutes,'study_seconds',coalesce(study_seconds,0),
      'required',required_for_official_certificate,'completed_at',scoped.completed_at)
      order by sort_order,name),'[]'::jsonb)
    into required_count,missing_count,certificate_completion_at,total_minutes,course_rows from scoped;
  if required_count=0 then raise exception 'A trilha não possui cursos obrigatórios disponíveis' using errcode='22023'; end if;
  if missing_count>0 then raise exception 'Há % curso(s) obrigatório(s) sem conclusão ou sem o tempo mínimo exigido',
    missing_count using errcode='22023'; end if;
  insert into public.cap_official_certificates(enrollment_id,employee_id,track_id,code,
    completion_at,snapshot)
    values(e.id,e.employee_id,t.id,upper(replace(pg_catalog.gen_random_uuid()::text,'-','') ||
      left(replace(pg_catalog.gen_random_uuid()::text,'-',''),4)),
      certificate_completion_at,jsonb_build_object('employee_name',employee_record->>'name',
        'track_name',t.name,'courses',course_rows,'total_minutes',total_minutes,
        'completed_at',certificate_completion_at,'employee_id',e.employee_id,
        'study_requirement_waived',admin_override))
    returning * into issued;
  insert into public.cap_official_certificate_events(certificate_id,action,actor_id,reason)
    values(issued.id,'issued',(select auth.uid()),
      case when admin_override then 'Emissão administrativa sem exigência do tempo mínimo de estudo' end);
  return to_jsonb(issued);
end;
$$;
revoke all on function public.hr_submit_request(text,bigint,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.hr_set_sector_manager_v55(text,uuid),
  public.hr_import_sector_catalog_v55(),
  public.hr_submit_request_v55(text,bigint,text,text,integer,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.hr_set_sector_manager_v55(text,uuid),
  public.hr_import_sector_catalog_v55(),
  public.hr_submit_request_v55(text,bigint,text,text,integer,text,text,text,text)
  to authenticated;
commit;
