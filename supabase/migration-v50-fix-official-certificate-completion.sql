begin;

create or replace function public.cap_issue_official_certificate_v49(target_enrollment uuid,admin_override boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.cap_enrollments%rowtype; t public.cap_tracks%rowtype;
  employee_record jsonb; course_rows jsonb; missing_count integer; required_count integer;
  certificate_completion_at timestamptz; total_minutes bigint; issued public.cap_official_certificates%rowtype;
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

commit;
