-- V46: gestão de equipe, vagas, transferências e acompanhamento de capacitação.
-- Aplicar após a V45. O portal só usa estas funções após a migração.
begin;

alter table public.admin_users drop constraint if exists admin_users_access_role_check;
alter table public.admin_users add constraint admin_users_access_role_check
  check (access_role in ('admin','usuario','gestor'));

create table public.hr_manager_team (
  employee_id bigint primary key,
  manager_id uuid not null references public.admin_users(id),
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id)
);
create index hr_manager_team_manager_idx on public.hr_manager_team(manager_id);
alter table public.hr_manager_team enable row level security;
revoke all on public.hr_manager_team from public,anon,authenticated;

create table public.hr_manager_supervisors (
  manager_id uuid primary key references public.admin_users(id),
  supervisor_id uuid not null references public.admin_users(id),
  check (manager_id <> supervisor_id)
);
alter table public.hr_manager_supervisors enable row level security;
revoke all on public.hr_manager_supervisors from public,anon,authenticated;

create table public.hr_requests (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('hire','transfer')),
  requester_id uuid not null references public.admin_users(id),
  employee_id bigint,
  current_sector text,
  target_sector text not null check (char_length(btrim(target_sector)) between 2 and 120),
  position_name text not null check (char_length(btrim(position_name)) between 2 and 160),
  quantity integer not null default 1 check (quantity between 1 and 1000),
  filled_quantity integer not null default 0 check (filled_quantity >= 0 and filled_quantity <= quantity),
  reason text not null check (char_length(btrim(reason)) between 8 and 4000),
  status text not null default 'requested' check (status in
    ('requested','immediate_approved','manager_accepted','approved','selecting','completed','rejected','cancelled')),
  immediate_approver_id uuid references public.admin_users(id),
  current_manager_id uuid references public.admin_users(id),
  current_manager_skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((kind='hire' and employee_id is null and current_sector is null)
    or (kind='transfer' and employee_id is not null and quantity=1 and filled_quantity=0))
);
create index hr_requests_requester_idx on public.hr_requests(requester_id,created_at desc);
create index hr_requests_current_manager_idx on public.hr_requests(current_manager_id,status);
create index hr_requests_immediate_idx on public.hr_requests(immediate_approver_id,status);
alter table public.hr_requests enable row level security;
revoke all on public.hr_requests from public,anon,authenticated;

create table public.hr_request_events (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.hr_requests(id),
  actor_id uuid not null references public.admin_users(id),
  action text not null,
  previous_status text,
  next_status text not null,
  note text,
  created_at timestamptz not null default now()
);
create index hr_request_events_request_idx on public.hr_request_events(request_id,id);
alter table public.hr_request_events enable row level security;
revoke all on public.hr_request_events from public,anon,authenticated;

create or replace function public.hr_is_manager()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.admin_users a where a.id=(select auth.uid())
    and a.active and not a.must_change_password and a.access_role='gestor');
$$;

create or replace function public.hr_can_see_employee(target_employee bigint)
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_admin() or (public.hr_is_manager() and exists(
    select 1 from public.hr_manager_team m where m.employee_id=target_employee
      and m.manager_id=(select auth.uid())));
$$;

create or replace function public.hr_set_team(target_manager uuid,target_employee bigint,enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem vincular equipes' using errcode='42501'; end if;
  if not exists(select 1 from public.admin_users where id=target_manager and active and access_role='gestor') then
    raise exception 'Selecione um gestor ativo' using errcode='22023'; end if;
  if not public.cap_employee_exists(target_employee) then raise exception 'Funcionário não encontrado' using errcode='22023'; end if;
  if enabled then
    insert into public.hr_manager_team(employee_id,manager_id,linked_by)
      values(target_employee,target_manager,(select auth.uid()))
      on conflict(employee_id) do update set manager_id=excluded.manager_id,
        linked_at=now(),linked_by=excluded.linked_by;
  else
    delete from public.hr_manager_team where employee_id=target_employee and manager_id=target_manager;
  end if;
end;
$$;

create or replace function public.hr_set_supervisor(target_manager uuid,target_supervisor uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if not exists(select 1 from public.admin_users where id=target_manager and active and access_role='gestor') then
    raise exception 'Gestor inválido' using errcode='22023'; end if;
  if target_supervisor is null then
    delete from public.hr_manager_supervisors where manager_id=target_manager;
  else
    if target_supervisor=target_manager or not exists(select 1 from public.admin_users
      where id=target_supervisor and active and access_role in ('gestor','admin')) then
      raise exception 'Responsável imediato inválido' using errcode='22023'; end if;
    insert into public.hr_manager_supervisors(manager_id,supervisor_id)
      values(target_manager,target_supervisor)
      on conflict(manager_id) do update set supervisor_id=excluded.supervisor_id;
  end if;
end;
$$;

create or replace function public.hr_submit_request(next_kind text,target_employee bigint,
  next_sector text,next_position text,next_quantity integer,next_reason text)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_id bigint; v_employee jsonb; v_current_manager uuid; v_supervisor uuid;
  v_sector text; v_position text;
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
    if lower(btrim(v_sector))=lower(btrim(next_sector)) then raise exception 'Escolha outro setor' using errcode='22023'; end if;
    if exists(select 1 from public.hr_requests where kind='transfer' and employee_id=target_employee
      and status not in ('completed','rejected','cancelled')) then
      raise exception 'Já existe transferência em andamento para este funcionário' using errcode='22023'; end if;
    select manager_id into v_current_manager from public.hr_manager_team where employee_id=target_employee;
    next_quantity:=1;
  else
    if char_length(btrim(coalesce(next_position,''))) not between 2 and 160
      or next_quantity not between 1 and 1000 then raise exception 'Informe cargo e quantidade de vagas' using errcode='22023'; end if;
    target_employee:=null; v_position:=btrim(next_position);
  end if;
  select supervisor_id into v_supervisor from public.hr_manager_supervisors
    where manager_id=(select auth.uid());
  insert into public.hr_requests(kind,requester_id,employee_id,current_sector,target_sector,
    position_name,quantity,reason,immediate_approver_id,current_manager_id,current_manager_skipped)
    values(next_kind,(select auth.uid()),target_employee,v_sector,btrim(next_sector),v_position,
      next_quantity,btrim(next_reason),v_supervisor,v_current_manager,
      next_kind='transfer' and (v_current_manager is null or v_current_manager=(select auth.uid())))
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
          then jsonb_set(item,'{sector}',to_jsonb(r.target_sector),true) else item end order by ord),'[]'::jsonb)
        from jsonb_array_elements(s.employees) with ordinality as e(item,ord)),
        version=version+1,updated_at=now(),updated_by=v_actor
        where s.id=1 and exists(select 1 from jsonb_array_elements(s.employees) as e(item)
          where (item->>'id')::bigint=r.employee_id and item->>'sector'=r.current_sector);
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
    'employees',coalesce((select jsonb_agg(jsonb_build_object('id',(emp->>'id')::bigint,
      'name',emp->>'name','sector',emp->>'sector','role',emp->>'role','mat',emp->>'mat',
      'manager_id',m.manager_id) order by emp->>'name')
      from public.app_state s cross join lateral jsonb_array_elements(s.employees) as e(emp)
      left join public.hr_manager_team m on m.employee_id=(emp->>'id')::bigint
      where s.id=1 and (v_admin or m.manager_id=v_actor)),'[]'::jsonb),
    'managers',case when v_admin then coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.full_name,'supervisor_id',sp.supervisor_id) order by a.full_name)
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
      'track_name',t.name,'employee_id',e.employee_id,'enrollment_id',e.id,
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
          or p.started_at is not null or p.completed_at is not null),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- A leitura do arquivo depende do vínculo atual e de um caminho registrado no banco.
create or replace function public.cap_can_read_certificate(object_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.cap_is_manager() or exists(
    select 1 from public.cap_enrollments e join public.cap_tracks t on t.id=e.track_id
    where e.id::text=split_part(object_path,'/',1)
      and e.removed_at is null and t.deleted_at is null
      and ((e.employee_id=public.cap_employee_id() and
        ((e.track_certificate_path=object_path and public.cap_owns_enrollment(e.id))
        or exists(select 1 from public.cap_progress p where p.enrollment_id=e.id
          and p.certificate_path=object_path and public.cap_can_access_course(e.id,p.course_id))))
        or (public.hr_is_manager() and exists(select 1 from public.hr_manager_team m
          where m.employee_id=e.employee_id and m.manager_id=(select auth.uid()))
          and (e.track_certificate_path=object_path or exists(select 1 from public.cap_progress p
            where p.enrollment_id=e.id and p.certificate_path=object_path)))));
$$;

-- Contas de gestor não recebem o JSON global de funcionários/treinamentos.
create or replace function public.load_portal_state()
returns table(version bigint, employees jsonb, trainings jsonb)
language plpgsql security definer set search_path='' as $$
declare v_role text; v_pages text[]; v_employees jsonb; v_trainings jsonb; v_version bigint;
begin
  select access_role,allowed_pages into v_role,v_pages from public.admin_users
    where id=(select auth.uid()) and active and not must_change_password;
  if v_role is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  select s.version,s.employees,s.trainings into v_version,v_employees,v_trainings
    from public.app_state s where s.id=1;
  version:=v_version;
  if v_role='admin' or 'reports'=any(v_pages) or
    ('employees'=any(v_pages) and 'trainings'=any(v_pages)) then
    employees:=v_employees; trainings:=v_trainings;
  elsif 'employees'=any(v_pages) then
    employees:=v_employees;
    select coalesce(jsonb_agg(jsonb_build_object('id',item->'id','date',item->'date',
      'name',item->'name','participants',coalesce(item->'participants','[]'::jsonb))),'[]'::jsonb)
      into trainings from jsonb_array_elements(v_trainings) t(item);
  elsif 'trainings'=any(v_pages) then
    trainings:=v_trainings;
    select coalesce(jsonb_agg(jsonb_build_object('id',item->'id','mat',item->'mat',
      'name',item->'name','sector',item->'sector','role',item->'role','status',item->'status')),'[]'::jsonb)
      into employees from jsonb_array_elements(v_employees) t(item);
  elsif 'dashboard'=any(v_pages) then
    employees:='[]'::jsonb;
    select coalesce(jsonb_agg((item - 'participants' - 'docs' - 'doc' - 'docFiles'
      - 'contentDocs' - 'contentDoc' - 'contentFiles' - 'docData' - 'contentData'
      - 'obs' - 'desc' - 'resp' - 'cancelReason' - 'statusChanges') ||
      jsonb_build_object('participantCount',jsonb_array_length(coalesce(item->'participants','[]'::jsonb)))),'[]'::jsonb)
      into trainings from jsonb_array_elements(v_trainings) t(item);
  else
    employees:='[]'::jsonb; trainings:='[]'::jsonb;
  end if;
  return next;
end;
$$;

-- Versão da função de acesso existente, acrescida do perfil Gestor sem outras telas.
create or replace function public.set_portal_access(target_id uuid,next_role text,next_pages text[],
  next_edits text[],next_employee_id bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Somente administradores podem alterar acessos' using errcode='42501'; end if;
  if target_id=(select auth.uid()) then raise exception 'Não altere o próprio perfil' using errcode='42501'; end if;
  if next_role not in ('admin','usuario','gestor') then raise exception 'Perfil inválido' using errcode='22023'; end if;
  if next_pages is null or not next_pages <@ array['dashboard','employees','trainings','reports','capacitation']::text[]
    or next_edits is null or not next_edits <@ array['employees','trainings','capacitation']::text[]
    or not next_edits <@ next_pages then raise exception 'Permissões inválidas' using errcode='22023'; end if;
  if next_role='usuario' and cardinality(next_pages)=0 then raise exception 'Escolha ao menos uma tela' using errcode='22023'; end if;
  if next_role='usuario' and 'capacitation'=any(next_pages) and
    (next_employee_id is null or not public.cap_employee_exists(next_employee_id)) then
    raise exception 'Vincule a conta a um funcionário para acessar Capacitação' using errcode='22023'; end if;
  update public.admin_users set access_role=next_role,
    allowed_pages=case when next_role='usuario' then next_pages else '{}'::text[] end,
    editable_pages=case when next_role='usuario' then next_edits else '{}'::text[] end,
    employee_id=case when next_role='usuario' and 'capacitation'=any(next_pages) then next_employee_id else null end
    where id=target_id and active;
  if not found then raise exception 'Conta não encontrada' using errcode='P0002'; end if;
end;
$$;

revoke all on function public.hr_is_manager(),public.hr_can_see_employee(bigint)
  from public,anon,authenticated;
revoke all on function public.hr_set_team(uuid,bigint,boolean),public.hr_set_supervisor(uuid,uuid),
  public.hr_submit_request(text,bigint,text,text,integer,text),
  public.hr_advance_request(bigint,text,text,integer),public.hr_dashboard()
  from public,anon;
grant execute on function public.hr_set_team(uuid,bigint,boolean),public.hr_set_supervisor(uuid,uuid),
  public.hr_submit_request(text,bigint,text,text,integer,text),
  public.hr_advance_request(bigint,text,text,integer),public.hr_dashboard()
  to authenticated;
commit;
