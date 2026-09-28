-- V16: remoção reversível de trilhas e inscrições, sem apagar o histórico ou certificados.
alter table public.cap_tracks add column if not exists deleted_at timestamptz;
alter table public.cap_enrollments add column if not exists removed_at timestamptz;

create or replace function public.cap_member_enrolled(target_track uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cap_enrollments e
    where e.track_id=target_track and e.employee_id=public.cap_employee_id()
      and e.removed_at is null);
$$;

create or replace function public.cap_owns_enrollment(target_enrollment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    where e.id=target_enrollment and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null);
$$;

drop policy if exists cap_tracks_read on public.cap_tracks;
create policy cap_tracks_read on public.cap_tracks for select to authenticated
  using (deleted_at is null and (public.cap_is_manager() or public.cap_member_enrolled(id)));
drop policy if exists cap_courses_read on public.cap_courses;
create policy cap_courses_read on public.cap_courses for select to authenticated
  using (exists(select 1 from public.cap_tracks t where t.id=track_id and t.deleted_at is null)
    and (public.cap_is_manager() or public.cap_member_enrolled(track_id)));
drop policy if exists cap_enrollments_read on public.cap_enrollments;
create policy cap_enrollments_read on public.cap_enrollments for select to authenticated
  using (removed_at is null and exists(select 1 from public.cap_tracks t
    where t.id=track_id and t.deleted_at is null)
    and (public.cap_is_manager() or employee_id=public.cap_employee_id()));
drop policy if exists cap_enrollments_insert on public.cap_enrollments;
create policy cap_enrollments_insert on public.cap_enrollments for insert to authenticated
  with check (public.cap_is_manager() and removed_at is null
    and public.cap_employee_exists(employee_id) and enrolled_by=(select auth.uid())
    and exists(select 1 from public.cap_tracks t where t.id=track_id and t.deleted_at is null));
drop policy if exists cap_progress_read on public.cap_progress;
create policy cap_progress_read on public.cap_progress for select to authenticated
  using (exists(select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    where e.id=enrollment_id and e.removed_at is null and t.deleted_at is null)
    and (public.cap_is_manager() or public.cap_owns_enrollment(enrollment_id)));

create or replace function public.cap_can_upload_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select object_path ~* '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(pdf|jpe?g|png)$'
    and exists(select 1 from public.cap_enrollments e
      join public.cap_tracks t on t.id=e.track_id and t.status='Ativa' and t.deleted_at is null
      join public.cap_courses c on c.track_id=e.track_id
      left join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
      where e.id::text=split_part(object_path,'/',1)
        and c.id::text=split_part(object_path,'/',2)
        and e.employee_id=public.cap_employee_id() and e.removed_at is null
        and public.can_view_portal_page('capacitation')
        and exists(select 1 from public.admin_users a where a.id=(select auth.uid())
          and 'capacitation'=any(a.editable_pages))
        and c.active and c.certificate_required
        and (p.certificate_path is null or p.validation_status='rejected'));
$$;

create or replace function public.cap_can_read_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.cap_is_manager() or exists(select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    where e.id::text=split_part(object_path,'/',1)
      and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null);
$$;

create or replace function public.cap_archive_track(target_track uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  update public.cap_tracks set deleted_at=now(),updated_at=now()
    where id=target_track and deleted_at is null;
  if not found then raise exception 'Trilha não encontrada' using errcode='P0002'; end if;
end;
$$;

create or replace function public.cap_remove_enrollment(target_enrollment uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  update public.cap_enrollments e set removed_at=now()
    from public.cap_tracks t
    where e.id=target_enrollment and t.id=e.track_id
      and t.deleted_at is null and e.removed_at is null;
  if not found then raise exception 'Inscrição não encontrada' using errcode='P0002'; end if;
end;
$$;

create or replace function public.cap_enroll_employees(target_track uuid,target_employee_ids bigint[])
returns void language plpgsql security definer set search_path = '' as $$
declare target_start date; target_days integer;
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if coalesce(array_length(target_employee_ids,1),0) not between 1 and 500
     or exists(select 1 from unnest(target_employee_ids) as ids(employee_id)
       where employee_id is null or not public.cap_employee_exists(employee_id)) then
    raise exception 'Selecione funcionários válidos' using errcode='22023';
  end if;
  select start_date,duration_days into target_start,target_days
    from public.cap_tracks where id=target_track and deleted_at is null;
  if not found then raise exception 'Trilha não encontrada' using errcode='P0002'; end if;
  insert into public.cap_enrollments(track_id,employee_id,start_date,due_date,enrolled_by,removed_at)
    select target_track,id,target_start,target_start+target_days,(select auth.uid()),null
    from (select distinct unnest(target_employee_ids) as id) people
    on conflict(track_id,employee_id) do update set
      removed_at=null,start_date=excluded.start_date,due_date=excluded.due_date,
      enrolled_at=now(),enrolled_by=excluded.enrolled_by;
end;
$$;

revoke all on function public.cap_archive_track(uuid),public.cap_remove_enrollment(uuid),public.cap_enroll_employees(uuid,bigint[]) from public,anon;
grant execute on function public.cap_archive_track(uuid),public.cap_remove_enrollment(uuid),public.cap_enroll_employees(uuid,bigint[]) to authenticated;
