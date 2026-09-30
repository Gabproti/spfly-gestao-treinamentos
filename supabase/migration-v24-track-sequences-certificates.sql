-- V24: pesquisa e sequências são campos de trilha; certificado final é privado por inscrição.
begin;

alter table public.cap_tracks add column if not exists sequence_name text not null default '';
alter table public.cap_tracks add column if not exists sequence_order integer not null default 1;
alter table public.cap_tracks add column if not exists certificate_mode text not null default 'per_course';
alter table public.cap_tracks add constraint cap_tracks_sequence_order_v24_check check (sequence_order between 1 and 999);
alter table public.cap_tracks add constraint cap_tracks_certificate_mode_v24_check check (certificate_mode in ('per_course','after_all'));
alter table public.cap_tracks add constraint cap_tracks_sequence_name_v24_check check (char_length(sequence_name) <= 120 and sequence_name=btrim(sequence_name));

create or replace function public.cap_check_certificate_mode_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.certificate_mode<>old.certificate_mode and exists
    (select 1 from public.cap_enrollments e where e.track_id=old.id) then
    raise exception 'Não é possível trocar o modo de certificado de uma trilha que já teve inscritos' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger cap_certificate_mode_change_v24 before update of certificate_mode on public.cap_tracks
  for each row execute function public.cap_check_certificate_mode_change();

alter table public.cap_enrollments add column if not exists track_certificate_path text;
alter table public.cap_enrollments add column if not exists track_certificate_name text;
alter table public.cap_enrollments add column if not exists track_certificate_uploaded_at timestamptz;
alter table public.cap_enrollments add column if not exists track_certificate_viewed_at timestamptz;
alter table public.cap_enrollments add column if not exists track_validation_status text not null default 'pending';
alter table public.cap_enrollments add column if not exists track_rejection_reason text;
alter table public.cap_enrollments add column if not exists track_validated_by uuid references auth.users(id);
alter table public.cap_enrollments add column if not exists track_validated_at timestamptz;
alter table public.cap_enrollments add constraint cap_enrollments_track_validation_v24_check check (track_validation_status in ('pending','approved','rejected'));

create or replace function public.cap_set_course_state(target_enrollment uuid,target_course uuid,next_state text)
returns void language plpgsql security definer set search_path = '' as $$
declare course_active boolean; needs_certificate boolean; track_status text;
begin
  select c.active,(c.certificate_required and t.certificate_mode='per_course'),t.status
    into course_active,needs_certificate,track_status
    from public.cap_enrollments e join public.cap_tracks t on t.id=e.track_id
    join public.cap_courses c on c.track_id=t.id
    where e.id=target_enrollment and c.id=target_course and e.removed_at is null and t.deleted_at is null;
  if not found or not course_active then raise exception 'Curso indisponível' using errcode='22023'; end if;
  if next_state='completed' and public.cap_is_manager() then
    if needs_certificate then raise exception 'Cursos com certificado exigem validação do documento' using errcode='22023'; end if;
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
      on conflict(enrollment_id,course_id) do update set started_at=coalesce(cap_progress.started_at,excluded.started_at);
  elsif next_state='finished' then
    update public.cap_progress set course_finished_at=now(),
      completed_at=case when needs_certificate then completed_at else now() end
      where enrollment_id=target_enrollment and course_id=target_course
        and started_at is not null and course_finished_at is null and completed_at is null;
    if not found then raise exception 'Inicie o curso antes de concluí-lo' using errcode='22023'; end if;
  else raise exception 'Estado inválido' using errcode='22023'; end if;
end;
$$;

create or replace function public.cap_can_upload_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select object_path ~* '^[a-f0-9-]{36}/([a-f0-9-]{36}|track)/[a-f0-9-]{36}\.(pdf|jpe?g|png)$'
    and exists(select 1 from public.cap_enrollments e
      join public.cap_tracks t on t.id=e.track_id and t.status='Ativa' and t.deleted_at is null
      where e.id::text=split_part(object_path,'/',1)
        and e.employee_id=public.cap_employee_id() and e.removed_at is null
        and public.cap_employee_matches_sectors(e.employee_id,t.sectors)
        and public.can_view_portal_page('capacitation')
        and exists(select 1 from public.admin_users a where a.id=(select auth.uid()) and a.active
          and not a.must_change_password and 'capacitation'=any(a.editable_pages))
        and ((split_part(object_path,'/',2)='track' and t.certificate_mode='after_all'
          and (e.track_certificate_path is null or e.track_validation_status='rejected')
          and exists(select 1 from public.cap_courses c where c.track_id=t.id and c.active)
          and not exists(select 1 from public.cap_courses c
            left join public.cap_progress p on p.course_id=c.id and p.enrollment_id=e.id
            where c.track_id=t.id and c.active and p.completed_at is null))
        or (t.certificate_mode='per_course' and exists(select 1 from public.cap_courses c
          join public.cap_progress p on p.course_id=c.id and p.enrollment_id=e.id
          where c.track_id=t.id and c.id::text=split_part(object_path,'/',2)
            and c.active and c.certificate_required and p.course_finished_at is not null
            and (p.certificate_path is null or p.validation_status='rejected')))));
$$;

create or replace function public.cap_attach_track_certificate(target_enrollment uuid,object_path text,file_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if split_part(object_path,'/',1)<>target_enrollment::text
    or split_part(object_path,'/',2)<>'track'
    or not public.cap_can_upload_certificate(object_path)
    or char_length(btrim(file_name)) not between 1 and 200
    or not exists(select 1 from storage.objects where bucket_id='cap-certificates' and name=object_path)
  then raise exception 'Certificado inválido ou não autorizado' using errcode='42501'; end if;
  update public.cap_enrollments set track_certificate_path=object_path,
    track_certificate_name=btrim(file_name),track_certificate_uploaded_at=now(),
    track_certificate_viewed_at=null,track_validation_status='pending',
    track_rejection_reason=null,track_validated_by=null,track_validated_at=null
    where id=target_enrollment and (track_certificate_path is null or track_validation_status='rejected');
  if not found then raise exception 'Certificado pendente ou aprovado não pode ser substituído' using errcode='42501'; end if;
end;
$$;

create or replace function public.cap_mark_track_certificate_viewed(target_enrollment uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  update public.cap_enrollments set track_certificate_viewed_at=coalesce(track_certificate_viewed_at,now())
    where id=target_enrollment and track_certificate_path is not null;
  if not found then raise exception 'Certificado não encontrado' using errcode='P0002'; end if;
end;
$$;

create or replace function public.cap_review_track_certificate(target_enrollment uuid,decision text,reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if decision not in ('approved','rejected') or (decision='rejected' and char_length(btrim(coalesce(reason,''))) not between 3 and 1000)
    then raise exception 'Informe a decisão e o motivo da rejeição' using errcode='22023'; end if;
  if decision='approved' and exists(select 1 from public.cap_enrollments e
    join public.cap_courses c on c.track_id=e.track_id and c.active
    left join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
    where e.id=target_enrollment and p.completed_at is null) then
    raise exception 'Conclua todos os cursos ativos antes de aprovar' using errcode='22023'; end if;
  update public.cap_enrollments set track_validation_status=decision,
    track_rejection_reason=case when decision='rejected' then btrim(reason) else null end,
    track_validated_by=(select auth.uid()),track_validated_at=now()
    where id=target_enrollment and track_certificate_path is not null and track_validation_status='pending'
      and (decision='rejected' or track_certificate_viewed_at is not null);
  if not found then raise exception 'Abra o certificado antes de aprovar ou verifique o estado atual' using errcode='22023'; end if;
end;
$$;

create or replace function public.cap_update_track_rejection_reason(target_enrollment uuid,new_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if char_length(btrim(coalesce(new_reason,''))) not between 3 and 1000 then
    raise exception 'Informe um motivo de 3 a 1000 caracteres' using errcode='22023'; end if;
  update public.cap_enrollments set track_rejection_reason=btrim(new_reason)
    where id=target_enrollment and track_certificate_path is not null and track_validation_status='rejected';
  if not found then raise exception 'Certificado recusado não encontrado' using errcode='P0002'; end if;
end;
$$;

revoke all on function public.cap_attach_track_certificate(uuid,text,text),
  public.cap_mark_track_certificate_viewed(uuid),public.cap_review_track_certificate(uuid,text,text),
  public.cap_update_track_rejection_reason(uuid,text) from public,anon;
grant execute on function public.cap_attach_track_certificate(uuid,text,text),
  public.cap_mark_track_certificate_viewed(uuid),public.cap_review_track_certificate(uuid,text,text),
  public.cap_update_track_rejection_reason(uuid,text) to authenticated;
commit;
