-- V28: permissao adicional de cursos por funcionario, sem mudar inscricoes regulares.
begin;

create table if not exists public.cap_course_grants (
  employee_id bigint not null,
  course_id uuid not null references public.cap_courses(id) on delete cascade,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (employee_id,course_id)
);
create index if not exists cap_course_grants_course_idx on public.cap_course_grants(course_id);
alter table public.cap_course_grants enable row level security;
revoke all on public.cap_course_grants from anon,authenticated;
grant select on public.cap_course_grants to authenticated;
create policy cap_course_grants_read on public.cap_course_grants for select to authenticated
  using (public.can_edit_portal_data('employees') or employee_id=public.cap_employee_id());

alter table public.cap_enrollments add column if not exists individual_only boolean not null default false;

create or replace function public.cap_has_course_grant(target_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_view_portal_page('capacitation') and exists (
    select 1 from public.cap_course_grants g
    where g.course_id=target_course and g.employee_id=public.cap_employee_id());
$$;
create or replace function public.cap_has_track_grant(target_track uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_view_portal_page('capacitation') and exists (
    select 1 from public.cap_course_grants g join public.cap_courses c on c.id=g.course_id
    where c.track_id=target_track and g.employee_id=public.cap_employee_id());
$$;

create or replace function public.cap_can_access_course(target_enrollment uuid,target_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    join public.cap_courses c on c.track_id=t.id and c.id=target_course
    where e.id=target_enrollment and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null
      and public.can_view_portal_page('capacitation')
      and ((not e.individual_only and public.cap_employee_matches_sectors(e.employee_id,t.sectors))
        or exists(select 1 from public.cap_course_grants g
          where g.employee_id=e.employee_id and g.course_id=c.id)));
$$;

create or replace function public.cap_member_enrolled(target_track uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    where e.track_id=target_track and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null and not e.individual_only
      and public.cap_employee_matches_sectors(e.employee_id,t.sectors));
$$;
create or replace function public.cap_owns_enrollment(target_enrollment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    where e.id=target_enrollment and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null
      and ((not e.individual_only and public.cap_employee_matches_sectors(e.employee_id,t.sectors))
        or exists(select 1 from public.cap_course_grants g join public.cap_courses c on c.id=g.course_id
          where g.employee_id=e.employee_id and c.track_id=e.track_id)));
$$;

drop policy if exists cap_tracks_read on public.cap_tracks;
create policy cap_tracks_read on public.cap_tracks for select to authenticated
  using (deleted_at is null and (public.cap_is_manager() or public.cap_member_enrolled(id)
    or public.cap_has_track_grant(id)));
drop policy if exists cap_courses_read on public.cap_courses;
create policy cap_courses_read on public.cap_courses for select to authenticated
  using (exists(select 1 from public.cap_tracks t where t.id=track_id and t.deleted_at is null)
    and (public.cap_is_manager() or public.cap_member_enrolled(track_id) or public.cap_has_course_grant(id)));
drop policy if exists cap_enrollments_read on public.cap_enrollments;
create policy cap_enrollments_read on public.cap_enrollments for select to authenticated
  using (removed_at is null and exists(select 1 from public.cap_tracks t
    where t.id=track_id and t.deleted_at is null
      and (public.cap_is_manager() or (employee_id=public.cap_employee_id()
        and ((not individual_only and public.cap_employee_matches_sectors(employee_id,t.sectors))
          or public.cap_has_track_grant(track_id))))));
drop policy if exists cap_progress_read on public.cap_progress;
create policy cap_progress_read on public.cap_progress for select to authenticated
  using (public.cap_is_manager() or public.cap_can_access_course(enrollment_id,course_id));

create or replace function public.cap_employee_course_options(target_employee_id bigint default null)
returns table(course_id uuid,course_name text,track_name text,modality text,granted boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_edit_portal_data('employees') then
    raise exception 'Acesso negado' using errcode='42501'; end if;
  return query select c.id,c.name,t.name,c.modality,
      exists(select 1 from public.cap_course_grants g where g.employee_id=target_employee_id and g.course_id=c.id)
    from public.cap_courses c join public.cap_tracks t on t.id=c.track_id
    where c.active and t.deleted_at is null
    order by t.name,c.sort_order,c.name;
end;
$$;

-- A inscricao administrativa transforma uma inscricao individual em inscricao completa.
create or replace function public.cap_enroll_employees(target_track uuid,target_employee_ids bigint[])
returns void language plpgsql security definer set search_path = '' as $$
declare target_start date; target_days integer; target_sectors text[];
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if coalesce(array_length(target_employee_ids,1),0) not between 1 and 500
    or exists(select 1 from unnest(target_employee_ids) as ids(employee_id)
      where employee_id is null or not public.cap_employee_exists(employee_id)) then
    raise exception 'Selecione funcionarios validos' using errcode='22023'; end if;
  select start_date,duration_days,sectors into target_start,target_days,target_sectors
    from public.cap_tracks where id=target_track and deleted_at is null;
  if not found then raise exception 'Trilha nao encontrada' using errcode='P0002'; end if;
  if exists(select 1 from unnest(target_employee_ids) as ids(employee_id)
    where not public.cap_employee_matches_sectors(employee_id,target_sectors)) then
    raise exception 'Selecione apenas funcionarios do setor destinatario' using errcode='22023'; end if;
  insert into public.cap_enrollments(track_id,employee_id,start_date,due_date,enrolled_by,removed_at,individual_only)
    select target_track,id,target_start,target_start+target_days,(select auth.uid()),null,false
    from (select distinct unnest(target_employee_ids) as id) people
    on conflict(track_id,employee_id) do update set
      removed_at=null,individual_only=false,start_date=excluded.start_date,due_date=excluded.due_date,
      enrolled_at=now(),enrolled_by=excluded.enrolled_by;
end;
$$;

create or replace function public.cap_check_track_sector_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.sectors) as names(name)
    where name<>btrim(name) or char_length(name) not between 1 and 120
      or not exists(select 1 from public.portal_sectors s where s.name=names.name))
    or (select count(*) from unnest(new.sectors))<>(select count(distinct name) from unnest(new.sectors) as names(name)) then
    raise exception 'Selecione setores cadastrados, sem repeticoes' using errcode='22023'; end if;
  if cardinality(new.sectors)>0 and exists(select 1 from public.cap_enrollments e
    where e.track_id=new.id and e.removed_at is null and not e.individual_only
      and not public.cap_employee_matches_sectors(e.employee_id,new.sectors)) then
    raise exception 'Remova os funcionarios de outros setores antes de alterar o setor da trilha' using errcode='22023'; end if;
  new.sector:=case when cardinality(new.sectors)=1 then new.sectors[1] else '' end;
  return new;
end;
$$;

create or replace function public.cap_remove_enrollment(target_enrollment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_employee bigint; target_track uuid;
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  select e.employee_id,e.track_id into target_employee,target_track
    from public.cap_enrollments e join public.cap_tracks t on t.id=e.track_id
    where e.id=target_enrollment and e.removed_at is null and t.deleted_at is null for update of e;
  if not found then raise exception 'Inscricao nao encontrada' using errcode='P0002'; end if;
  delete from public.cap_course_grants g using public.cap_courses c
    where g.course_id=c.id and g.employee_id=target_employee and c.track_id=target_track;
  update public.cap_enrollments set removed_at=now() where id=target_enrollment;
end;
$$;

create or replace function public.cap_set_course_state(target_enrollment uuid,target_course uuid,next_state text)
returns void language plpgsql security definer set search_path = '' as $$
declare course_active boolean; needs_certificate boolean; track_status text;
begin
  select c.active,(c.certificate_required and t.certificate_mode='per_course'),t.status
    into course_active,needs_certificate,track_status
    from public.cap_enrollments e join public.cap_tracks t on t.id=e.track_id
    join public.cap_courses c on c.track_id=t.id
    where e.id=target_enrollment and c.id=target_course and e.removed_at is null and t.deleted_at is null;
  if not found or not course_active then raise exception 'Curso indisponivel' using errcode='22023'; end if;
  if next_state='completed' and public.cap_is_manager() then
    if needs_certificate then raise exception 'Curso exige validacao do certificado' using errcode='22023'; end if;
    insert into public.cap_progress(enrollment_id,course_id,started_at,course_finished_at,completed_at)
      values(target_enrollment,target_course,now(),now(),now())
      on conflict(enrollment_id,course_id) do update set
        started_at=coalesce(cap_progress.started_at,excluded.started_at),
        course_finished_at=coalesce(cap_progress.course_finished_at,excluded.course_finished_at),
        completed_at=coalesce(cap_progress.completed_at,excluded.completed_at);
    return;
  end if;
  if not public.cap_can_access_course(target_enrollment,target_course)
    or not exists(select 1 from public.admin_users a where a.id=(select auth.uid())
      and a.active and not a.must_change_password and a.access_role='usuario'
      and 'capacitation'=any(a.editable_pages)) then
    raise exception 'Acesso negado' using errcode='42501'; end if;
  if track_status<>'Ativa' then raise exception 'Trilha indisponivel' using errcode='22023'; end if;
  if next_state='started' then
    insert into public.cap_progress(enrollment_id,course_id,started_at)
      values(target_enrollment,target_course,now())
      on conflict(enrollment_id,course_id) do update set started_at=coalesce(cap_progress.started_at,excluded.started_at);
  elsif next_state='finished' then
    update public.cap_progress set course_finished_at=now(),
      completed_at=case when needs_certificate then completed_at else now() end
      where enrollment_id=target_enrollment and course_id=target_course
        and started_at is not null and course_finished_at is null and completed_at is null;
    if not found then raise exception 'Inicie o curso antes de conclui-lo' using errcode='22023'; end if;
  else raise exception 'Estado invalido' using errcode='22023'; end if;
end;
$$;

create or replace function public.cap_set_employee_course_grants(target_employee_id bigint,target_course_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare selected uuid[] := coalesce(target_course_ids,'{}'::uuid[]);
begin
  if not public.can_edit_portal_data('employees') then
    raise exception 'Acesso negado' using errcode='42501'; end if;
  if not public.cap_employee_exists(target_employee_id) then
    raise exception 'Funcionario nao encontrado' using errcode='P0002'; end if;
  if cardinality(selected)>2000 or array_position(selected,null) is not null
    or (select count(*) from unnest(selected))<>(select count(distinct id) from unnest(selected) as ids(id))
    or exists(select 1 from unnest(selected) as ids(id) where not exists(
      select 1 from public.cap_courses c join public.cap_tracks t on t.id=c.track_id
      where c.id=ids.id and c.active and t.deleted_at is null)) then
    raise exception 'Selecao de cursos invalida' using errcode='22023'; end if;
  insert into public.cap_course_grants(employee_id,course_id,granted_by)
    select target_employee_id,id,(select auth.uid()) from unnest(selected) as ids(id)
    on conflict(employee_id,course_id) do nothing;
  delete from public.cap_course_grants g where g.employee_id=target_employee_id
    and not (g.course_id=any(selected));
  insert into public.cap_enrollments(track_id,employee_id,start_date,due_date,enrolled_by,individual_only)
    select distinct t.id,target_employee_id,current_date,current_date+t.duration_days,(select auth.uid()),true
    from public.cap_course_grants g join public.cap_courses c on c.id=g.course_id
    join public.cap_tracks t on t.id=c.track_id
    where g.employee_id=target_employee_id and t.deleted_at is null
    on conflict(track_id,employee_id) do update set
      individual_only=case when cap_enrollments.removed_at is null
        and not cap_enrollments.individual_only
        and public.cap_employee_matches_sectors(target_employee_id,
          (select sectors from public.cap_tracks where id=excluded.track_id))
        then false else true end,
      removed_at=null;
  update public.cap_enrollments e set removed_at=now()
    where e.employee_id=target_employee_id and e.individual_only and e.removed_at is null
      and not exists(select 1 from public.cap_course_grants g join public.cap_courses c on c.id=g.course_id
        where g.employee_id=e.employee_id and c.track_id=e.track_id);
end;
$$;

create or replace function public.cap_can_upload_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select object_path ~* '^[a-f0-9-]{36}/([a-f0-9-]{36}|track)/[a-f0-9-]{36}\.(pdf|jpe?g|png)$'
    and exists(select 1 from public.cap_enrollments e
      join public.cap_tracks t on t.id=e.track_id and t.status='Ativa' and t.deleted_at is null
      where e.id::text=split_part(object_path,'/',1)
        and e.employee_id=public.cap_employee_id() and e.removed_at is null
        and public.can_view_portal_page('capacitation')
        and exists(select 1 from public.admin_users a where a.id=(select auth.uid()) and a.active
          and not a.must_change_password and 'capacitation'=any(a.editable_pages))
        and ((split_part(object_path,'/',2)='track' and t.certificate_mode='after_all'
          and public.cap_owns_enrollment(e.id)
          and (e.track_certificate_path is null or e.track_validation_status='rejected')
          and exists(select 1 from public.cap_courses c where c.track_id=t.id and c.active
            and (not e.individual_only or exists(select 1 from public.cap_course_grants g
              where g.employee_id=e.employee_id and g.course_id=c.id)))
          and not exists(select 1 from public.cap_courses c
            left join public.cap_progress p on p.course_id=c.id and p.enrollment_id=e.id
            where c.track_id=t.id and c.active and p.completed_at is null
              and (not e.individual_only or exists(select 1 from public.cap_course_grants g
                where g.employee_id=e.employee_id and g.course_id=c.id))))
        or (t.certificate_mode='per_course' and exists(select 1 from public.cap_courses c
          join public.cap_progress p on p.course_id=c.id and p.enrollment_id=e.id
          where c.track_id=t.id and c.id::text=split_part(object_path,'/',2)
            and public.cap_can_access_course(e.id,c.id)
            and c.active and c.certificate_required and p.course_finished_at is not null
            and (p.certificate_path is null or p.validation_status='rejected')))));
$$;

create or replace function public.cap_can_read_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.cap_is_manager() or exists(
    select 1 from public.cap_enrollments e join public.cap_tracks t on t.id=e.track_id
    where e.id::text=split_part(object_path,'/',1)
      and e.employee_id=public.cap_employee_id() and e.removed_at is null and t.deleted_at is null
      and ((e.track_certificate_path=object_path and public.cap_owns_enrollment(e.id))
        or exists(select 1 from public.cap_progress p
          where p.enrollment_id=e.id and p.certificate_path=object_path
            and (not e.individual_only or public.cap_can_access_course(e.id,p.course_id)))));
$$;

create or replace function public.cap_review_track_certificate(target_enrollment uuid,decision text,reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if decision not in ('approved','rejected') or
    (decision='rejected' and char_length(btrim(coalesce(reason,''))) not between 3 and 1000) then
    raise exception 'Informe a decisao e o motivo da rejeicao' using errcode='22023'; end if;
  if decision='approved' and exists(select 1 from public.cap_enrollments e
    join public.cap_courses c on c.track_id=e.track_id and c.active
    left join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
    where e.id=target_enrollment and p.completed_at is null
      and (not e.individual_only or exists(select 1 from public.cap_course_grants g
        where g.employee_id=e.employee_id and g.course_id=c.id))) then
    raise exception 'Conclua todos os cursos disponiveis antes de aprovar' using errcode='22023'; end if;
  update public.cap_enrollments set track_validation_status=decision,
    track_rejection_reason=case when decision='rejected' then btrim(reason) else null end,
    track_validated_by=(select auth.uid()),track_validated_at=now()
    where id=target_enrollment and track_certificate_path is not null and track_validation_status='pending'
      and (decision='rejected' or track_certificate_viewed_at is not null);
  if not found then raise exception 'Abra o certificado antes de aprovar ou verifique o estado atual' using errcode='22023'; end if;
end;
$$;

create or replace function public.cap_employee_history(target_employee_id bigint)
returns table (
  enrollment_id uuid, enrollment_start date, enrollment_due date,
  enrolled_at timestamptz, removed_at timestamptz,
  track_id uuid, track_name text, track_type text, track_status text,
  track_deleted_at timestamptz, course_id uuid, course_name text,
  course_active boolean, course_order integer, certificate_required boolean,
  started_at timestamptz, course_finished_at timestamptz, completed_at timestamptz,
  certificate_path text, certificate_name text, certificate_uploaded_at timestamptz,
  validation_status text, rejection_reason text
)
language sql stable security definer set search_path = '' as $$
  select e.id,e.start_date,e.due_date,e.enrolled_at,e.removed_at,
    t.id,t.name,t.track_type,t.status,t.deleted_at,
    c.id,c.name,c.active,c.sort_order,c.certificate_required,
    p.started_at,p.course_finished_at,p.completed_at,p.certificate_path,
    p.certificate_name,p.certificate_uploaded_at,p.validation_status,p.rejection_reason
  from public.cap_enrollments e
  join public.cap_tracks t on t.id=e.track_id
  left join public.cap_courses c on c.track_id=t.id
    and (not e.individual_only or exists(select 1 from public.cap_course_grants g
      where g.employee_id=e.employee_id and g.course_id=c.id))
  left join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
  where e.employee_id=target_employee_id
    and (public.cap_is_manager()
      or (public.cap_employee_id()=target_employee_id
        and e.removed_at is null and t.deleted_at is null
        and ((not e.individual_only and public.cap_employee_matches_sectors(e.employee_id,t.sectors))
          or exists(select 1 from public.cap_course_grants g join public.cap_courses cc on cc.id=g.course_id
            where g.employee_id=e.employee_id and cc.track_id=e.track_id))))
  order by e.enrolled_at desc,c.sort_order,c.name;
$$;

revoke all on function public.cap_has_course_grant(uuid),public.cap_has_track_grant(uuid),public.cap_can_access_course(uuid,uuid),
  public.cap_employee_course_options(bigint),public.cap_set_employee_course_grants(bigint,uuid[]) from public,anon;
grant execute on function public.cap_has_course_grant(uuid),public.cap_has_track_grant(uuid),public.cap_can_access_course(uuid,uuid),
  public.cap_employee_course_options(bigint),public.cap_set_employee_course_grants(bigint,uuid[]) to authenticated;
commit;
