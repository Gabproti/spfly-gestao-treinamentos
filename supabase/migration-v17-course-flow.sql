-- V17: início e término do curso pelo funcionário; certificado após terminar.
alter table public.cap_progress add column if not exists course_finished_at timestamptz;
update public.cap_progress
  set course_finished_at=coalesce(completed_at,certificate_uploaded_at)
  where course_finished_at is null and (completed_at is not null or certificate_uploaded_at is not null);

create or replace function public.cap_set_course_state(target_enrollment uuid,target_course uuid,next_state text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  course_active boolean;
  needs_certificate boolean;
  track_status text;
begin
  select c.active,c.certificate_required,t.status
    into course_active,needs_certificate,track_status
    from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    join public.cap_courses c on c.track_id=t.id
    where e.id=target_enrollment and c.id=target_course
      and e.removed_at is null and t.deleted_at is null;
  if not found or not course_active then
    raise exception 'Curso indisponível' using errcode='22023';
  end if;

  if next_state='completed' and public.cap_is_manager() then
    if needs_certificate then
      raise exception 'Cursos com certificado exigem validação do documento' using errcode='22023';
    end if;
    insert into public.cap_progress(enrollment_id,course_id,started_at,course_finished_at,completed_at)
      values(target_enrollment,target_course,now(),now(),now())
      on conflict(enrollment_id,course_id) do update set
        started_at=coalesce(cap_progress.started_at,excluded.started_at),
        course_finished_at=coalesce(cap_progress.course_finished_at,excluded.course_finished_at),
        completed_at=coalesce(cap_progress.completed_at,excluded.completed_at);
    return;
  end if;

  if not public.cap_owns_enrollment(target_enrollment)
     or not exists(select 1 from public.admin_users a where a.id=(select auth.uid())
       and a.active and not a.must_change_password and a.access_role='usuario'
       and 'capacitation'=any(a.editable_pages)) then
    raise exception 'Acesso negado' using errcode='42501';
  end if;
  if track_status<>'Ativa' then raise exception 'Trilha indisponível' using errcode='22023'; end if;

  if next_state='started' then
    insert into public.cap_progress(enrollment_id,course_id,started_at)
      values(target_enrollment,target_course,now())
      on conflict(enrollment_id,course_id) do update
        set started_at=coalesce(cap_progress.started_at,excluded.started_at);
  elsif next_state='finished' then
    update public.cap_progress set course_finished_at=now(),
      completed_at=case when needs_certificate then completed_at else now() end
      where enrollment_id=target_enrollment and course_id=target_course
        and started_at is not null and course_finished_at is null and completed_at is null;
    if not found then raise exception 'Inicie o curso antes de concluí-lo' using errcode='22023'; end if;
  else
    raise exception 'Estado inválido' using errcode='22023';
  end if;
end;
$$;

create or replace function public.cap_can_upload_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select object_path ~* '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(pdf|jpe?g|png)$'
    and exists(select 1 from public.cap_enrollments e
      join public.cap_tracks t on t.id=e.track_id and t.status='Ativa' and t.deleted_at is null
      join public.cap_courses c on c.track_id=e.track_id
      join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
      where e.id::text=split_part(object_path,'/',1)
        and c.id::text=split_part(object_path,'/',2)
        and e.employee_id=public.cap_employee_id() and e.removed_at is null
        and public.can_view_portal_page('capacitation')
        and exists(select 1 from public.admin_users a where a.id=(select auth.uid())
          and 'capacitation'=any(a.editable_pages))
        and c.active and c.certificate_required and p.course_finished_at is not null
        and (p.certificate_path is null or p.validation_status='rejected'));
$$;
