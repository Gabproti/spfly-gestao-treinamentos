-- V49: sessões de estudo e certificado oficial de conclusão de trilha.
-- Execute após V46. Trilhas existentes permanecem no fluxo atual até ativação explícita.
begin;

alter table public.cap_tracks add column if not exists official_certificate_enabled boolean not null default false;
alter table public.cap_courses add column if not exists min_study_minutes integer;
alter table public.cap_courses add column if not exists required_for_official_certificate boolean not null default true;
-- Cursos já cadastrados recebem automaticamente 90% da carga horária, arredondados para cima.
update public.cap_courses set min_study_minutes=ceil(duration_minutes*0.9)::integer
  where min_study_minutes is null;
alter table public.cap_courses alter column min_study_minutes set not null;
alter table public.cap_courses add constraint cap_courses_min_study_v49_check
  check (min_study_minutes between ceil(duration_minutes*0.9)::integer and duration_minutes);
-- Mantém o percentual ao criar cursos por chamadas antigas ou alterar sua carga horária.
create function public.cap_adjust_study_minimum_v49()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.min_study_minutes := least(new.duration_minutes,
    greatest(coalesce(new.min_study_minutes,0),ceil(new.duration_minutes*0.9)::integer));
  return new;
end;
$$;
create trigger cap_adjust_study_minimum_v49 before insert or update of duration_minutes
  on public.cap_courses for each row execute function public.cap_adjust_study_minimum_v49();
alter table public.cap_progress add column if not exists study_seconds bigint not null default 0;
alter table public.cap_progress add constraint cap_progress_study_seconds_v49_check check (study_seconds >= 0);
grant update(official_certificate_enabled) on public.cap_tracks to authenticated;

create table public.cap_study_sessions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.cap_enrollments(id),
  course_id uuid not null references public.cap_courses(id),
  user_id uuid not null references auth.users(id),
  started_at timestamptz not null default clock_timestamp(),
  last_heartbeat_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  credited_seconds bigint not null default 0 check (credited_seconds >= 0)
);
create unique index cap_one_open_study_session_v49 on public.cap_study_sessions(enrollment_id,course_id)
  where ended_at is null;
create index cap_study_sessions_employee_v49 on public.cap_study_sessions(user_id,started_at desc);
alter table public.cap_study_sessions enable row level security;
revoke all on public.cap_study_sessions from public,anon,authenticated;
grant select on public.cap_study_sessions to authenticated;
create policy cap_study_sessions_read_v49 on public.cap_study_sessions for select to authenticated
  using (user_id=(select auth.uid()) or public.cap_is_manager());

create table public.cap_official_certificates (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.cap_enrollments(id),
  employee_id bigint not null,
  track_id uuid not null references public.cap_tracks(id),
  code text not null unique check (code ~ '^[A-F0-9]{36}$'),
  issued_at timestamptz not null default clock_timestamp(),
  completion_at timestamptz not null,
  status text not null default 'valid' check (status in ('valid','invalidated')),
  snapshot jsonb not null,
  invalidated_at timestamptz,
  invalidated_by uuid references auth.users(id),
  invalidation_reason text
);
create unique index cap_one_valid_official_certificate_v49
  on public.cap_official_certificates(enrollment_id) where status='valid';
create index cap_official_certificates_employee_v49
  on public.cap_official_certificates(employee_id,issued_at desc);
alter table public.cap_official_certificates enable row level security;
revoke all on public.cap_official_certificates from public,anon,authenticated;
grant select on public.cap_official_certificates to authenticated;
create policy cap_official_certificates_read_v49 on public.cap_official_certificates for select to authenticated
  using (public.cap_is_manager() or employee_id=public.cap_employee_id());

create table public.cap_official_certificate_events (
  id bigint generated always as identity primary key,
  certificate_id uuid not null references public.cap_official_certificates(id),
  action text not null check (action in ('issued','invalidated')),
  actor_id uuid not null references auth.users(id),
  reason text,
  occurred_at timestamptz not null default clock_timestamp()
);
alter table public.cap_official_certificate_events enable row level security;
revoke all on public.cap_official_certificate_events from public,anon,authenticated;
grant select on public.cap_official_certificate_events to authenticated;
create policy cap_official_certificate_events_read_v49 on public.cap_official_certificate_events
  for select to authenticated using (public.cap_is_manager());

-- Mantém cap_save_course para sessões antigas. O novo RPC grava curso e critérios na mesma transação.
create function public.cap_save_course_v49(
  target_course uuid,target_track uuid,course_name text,course_description text,course_url text,
  course_minutes integer,course_modality text,course_order integer,course_certificate_required boolean,
  course_active boolean,target_systems text[],target_employee_ids bigint[],
  course_min_study_minutes integer,course_required_for_official boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare saved_id uuid;
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if course_min_study_minutes is not null and
     (course_min_study_minutes < ceil(course_minutes*0.9)::integer
       or course_min_study_minutes > course_minutes) then
    raise exception 'O tempo mínimo deve ficar entre 90%% e 100%% da carga horária do curso' using errcode='22023'; end if;
  saved_id := public.cap_save_course(target_course,target_track,course_name,course_description,
    course_url,course_minutes,course_modality,course_order,course_certificate_required,
    course_active,target_systems,target_employee_ids);
  update public.cap_courses set min_study_minutes=coalesce(course_min_study_minutes,ceil(course_minutes*0.9)::integer),
    required_for_official_certificate=coalesce(course_required_for_official,true)
    where id=saved_id;
  return saved_id;
end;
$$;

-- Protege também conclusões escritas por RPCs antigos ou administrativos.
create function public.cap_enforce_official_completion_v49()
returns trigger language plpgsql security definer set search_path = '' as $$
declare minimum_minutes integer; enabled boolean;
begin
  if (new.course_finished_at is not null and (tg_op='INSERT' or old.course_finished_at is null))
     or (new.completed_at is not null and (tg_op='INSERT' or old.completed_at is null)) then
    select t.official_certificate_enabled,c.min_study_minutes into enabled,minimum_minutes
      from public.cap_enrollments e join public.cap_tracks t on t.id=e.track_id
      join public.cap_courses c on c.id=new.course_id and c.track_id=t.id
      where e.id=new.enrollment_id;
    -- O administrador pode confirmar a conclusão sem tempo de estudo; usuários seguem a regra de 90%.
    if enabled and not public.cap_is_manager() then
      if minimum_minutes is null then
        raise exception 'Configure a duração mínima do curso antes de concluí-lo' using errcode='22023'; end if;
      if new.study_seconds < minimum_minutes::bigint*60 then
        raise exception 'Tempo mínimo não cumprido. Faltam % minuto(s)',
          ceil((minimum_minutes::bigint*60-new.study_seconds)/60.0)::integer using errcode='22023';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger cap_enforce_official_completion_v49 before insert or update of course_finished_at,completed_at
  on public.cap_progress for each row execute function public.cap_enforce_official_completion_v49();

create function public.cap_begin_study_v49(target_enrollment uuid,target_course uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare session_id uuid; minimum_minutes integer;
begin
  if not public.cap_can_access_course(target_enrollment,target_course)
     or not exists(select 1 from public.admin_users a where a.id=(select auth.uid())
       and a.active and not a.must_change_password and a.access_role='usuario'
       and 'capacitation'=any(a.editable_pages)) then
    raise exception 'Acesso negado' using errcode='42501'; end if;
  select c.min_study_minutes into minimum_minutes
    from public.cap_enrollments e join public.cap_tracks t on t.id=e.track_id
    join public.cap_courses c on c.track_id=t.id and c.id=target_course
    where e.id=target_enrollment and e.removed_at is null and t.deleted_at is null
      and t.status='Ativa' and t.official_certificate_enabled and c.active;
  if not found then raise exception 'Curso indisponível para estudo monitorado' using errcode='22023'; end if;
  if minimum_minutes is null then
    raise exception 'O administrador precisa configurar a duração mínima deste curso' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_enrollment::text||target_course::text,0));
  update public.cap_study_sessions set ended_at=clock_timestamp()
    where enrollment_id=target_enrollment and course_id=target_course and ended_at is null;
  insert into public.cap_progress(enrollment_id,course_id,started_at)
    values(target_enrollment,target_course,clock_timestamp())
    on conflict(enrollment_id,course_id) do update set started_at=coalesce(cap_progress.started_at,excluded.started_at);
  insert into public.cap_study_sessions(enrollment_id,course_id,user_id)
    values(target_enrollment,target_course,(select auth.uid())) returning id into session_id;
  return session_id;
end;
$$;

-- O cliente apenas indica atividade; os segundos são calculados pelo relógio do banco.
-- Intervalos longos ou sessões substituídas não recebem crédito.
create function public.cap_study_heartbeat_v49(target_session uuid,finish boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare s public.cap_study_sessions%rowtype; received_at timestamptz := clock_timestamp();
  elapsed_seconds integer; total_seconds bigint;
begin
  select * into s from public.cap_study_sessions where id=target_session for update;
  if not found or s.user_id is distinct from (select auth.uid()) or s.ended_at is not null then
    raise exception 'Sessão de estudo encerrada' using errcode='42501'; end if;
  if not public.cap_can_access_course(s.enrollment_id,s.course_id)
    or not exists(select 1 from public.cap_enrollments e
      join public.cap_tracks t on t.id=e.track_id
      join public.cap_courses c on c.track_id=t.id and c.id=s.course_id
      where e.id=s.enrollment_id and e.removed_at is null and t.deleted_at is null
        and t.status='Ativa' and t.official_certificate_enabled and c.active) then
    raise exception 'Curso indisponível' using errcode='42501'; end if;
  elapsed_seconds := floor(extract(epoch from received_at-s.last_heartbeat_at))::integer;
  if elapsed_seconds < 0 then elapsed_seconds := 0; end if;
  if elapsed_seconds > 45 then
    update public.cap_study_sessions set ended_at=received_at where id=s.id;
    return -1;
  end if;
  update public.cap_study_sessions set last_heartbeat_at=received_at,
    credited_seconds=credited_seconds+elapsed_seconds,
    ended_at=case when finish then received_at else null end where id=s.id;
  update public.cap_progress set study_seconds=study_seconds+elapsed_seconds
    where enrollment_id=s.enrollment_id and course_id=s.course_id
    returning study_seconds into total_seconds;
  return total_seconds;
end;
$$;

create function public.cap_issue_official_certificate_v49(target_enrollment uuid,admin_override boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.cap_enrollments%rowtype; t public.cap_tracks%rowtype;
  employee_record jsonb; course_rows jsonb; missing_count integer; required_count integer;
  completed_at timestamptz; total_minutes bigint; issued public.cap_official_certificates%rowtype;
begin
  admin_override := coalesce(admin_override,false);
  select * into e from public.cap_enrollments where id=target_enrollment and removed_at is null for update;
  if not found then raise exception 'Inscrição não encontrada' using errcode='P0002'; end if;
  if not public.cap_is_manager() and not public.cap_owns_enrollment(target_enrollment) then
    raise exception 'Acesso negado' using errcode='42501'; end if;
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
      (completed_at is null or (not admin_override and
        (min_study_minutes is null or study_seconds < min_study_minutes::bigint*60)))),
    max(completed_at) filter(where required_for_official_certificate),
    coalesce(sum(duration_minutes) filter(where completed_at is not null),0),
    coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'duration_minutes',duration_minutes,
      'min_study_minutes',min_study_minutes,'study_seconds',coalesce(study_seconds,0),
      'required',required_for_official_certificate,'completed_at',completed_at)
      order by sort_order,name),'[]'::jsonb)
    into required_count,missing_count,completed_at,total_minutes,course_rows from scoped;
  if required_count=0 then raise exception 'A trilha não possui cursos obrigatórios disponíveis' using errcode='22023'; end if;
  if missing_count>0 then raise exception 'Há % curso(s) obrigatório(s) sem conclusão ou sem o tempo mínimo exigido',
    missing_count using errcode='22023'; end if;
  insert into public.cap_official_certificates(enrollment_id,employee_id,track_id,code,
    completion_at,snapshot)
    values(e.id,e.employee_id,t.id,upper(replace(pg_catalog.gen_random_uuid()::text,'-','') ||
      left(replace(pg_catalog.gen_random_uuid()::text,'-',''),4)),
      completed_at,jsonb_build_object('employee_name',employee_record->>'name',
        'track_name',t.name,'courses',course_rows,'total_minutes',total_minutes,
        'completed_at',completed_at,'employee_id',e.employee_id,
        'study_requirement_waived',admin_override))
    returning * into issued;
  insert into public.cap_official_certificate_events(certificate_id,action,actor_id,reason)
    values(issued.id,'issued',(select auth.uid()),
      case when admin_override then 'Emissão administrativa sem exigência do tempo mínimo de estudo' end);
  return to_jsonb(issued);
end;
$$;

create function public.cap_invalidate_official_certificate_v49(target_certificate uuid,reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if char_length(btrim(coalesce(reason,''))) not between 10 and 1000 then
    raise exception 'Informe uma justificativa de 10 a 1000 caracteres' using errcode='22023'; end if;
  update public.cap_official_certificates set status='invalidated',invalidated_at=clock_timestamp(),
    invalidated_by=(select auth.uid()),invalidation_reason=btrim(reason)
    where id=target_certificate and status='valid';
  if not found then raise exception 'Certificado válido não encontrado' using errcode='P0002'; end if;
  insert into public.cap_official_certificate_events(certificate_id,action,actor_id,reason)
    values(target_certificate,'invalidated',(select auth.uid()),btrim(reason));
end;
$$;

-- Consulta pública restrita ao código aleatório. Não expõe CPF, matrícula ou nome completo.
create function public.cap_verify_official_certificate_v49(certificate_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cert public.cap_official_certificates%rowtype; full_name text; first_name text;
begin
  if certificate_code is null or certificate_code !~ '^[A-Fa-f0-9]{36}$' then
    return jsonb_build_object('found',false); end if;
  select * into cert from public.cap_official_certificates
    where code=upper(certificate_code) limit 1;
  if not found then return jsonb_build_object('found',false); end if;
  full_name := coalesce(cert.snapshot->>'employee_name','');
  first_name := split_part(full_name,' ',1);
  return jsonb_build_object('found',true,'valid',cert.status='valid',
    'status',cert.status,'employee',first_name||' '||left(split_part(full_name,' ',
      array_length(string_to_array(full_name,' '),1)),1)||'.',
    'track',cert.snapshot->>'track_name','completed_at',cert.completion_at,
    'issued_at',cert.issued_at,'code',cert.code);
end;
$$;

revoke all on function public.cap_save_course_v49(uuid,uuid,text,text,text,integer,text,integer,boolean,boolean,text[],bigint[],integer,boolean),
  public.cap_begin_study_v49(uuid,uuid),public.cap_study_heartbeat_v49(uuid,boolean),
  public.cap_issue_official_certificate_v49(uuid,boolean),
  public.cap_invalidate_official_certificate_v49(uuid,text),
  public.cap_verify_official_certificate_v49(text) from public,anon,authenticated;
grant execute on function public.cap_save_course_v49(uuid,uuid,text,text,text,integer,text,integer,boolean,boolean,text[],bigint[],integer,boolean),
  public.cap_begin_study_v49(uuid,uuid),public.cap_study_heartbeat_v49(uuid,boolean),
  public.cap_issue_official_certificate_v49(uuid,boolean),
  public.cap_invalidate_official_certificate_v49(uuid,text) to authenticated;
grant execute on function public.cap_verify_official_certificate_v49(text) to anon,authenticated;

commit;
