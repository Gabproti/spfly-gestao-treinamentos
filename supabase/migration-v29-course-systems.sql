-- V29: classificação de cursos por sistema, adicional a setores e liberações individuais.
-- Cursos anteriores ficam sem classificação e continuam disponíveis pelas regras atuais.
begin;

create table if not exists public.cap_systems (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  name text not null unique
);
insert into public.cap_systems(code,name) values ('TMS','TMS'),('WMS','WMS') on conflict (code) do nothing;
revoke all on public.cap_systems from anon,authenticated;
grant select on public.cap_systems to authenticated;
alter table public.cap_systems enable row level security;
create policy cap_systems_read on public.cap_systems for select to authenticated using (true);

create table if not exists public.cap_course_systems (
  course_id uuid not null references public.cap_courses(id) on delete cascade,
  system_code text not null references public.cap_systems(code),
  primary key (course_id,system_code)
);
create index if not exists cap_course_systems_system_idx on public.cap_course_systems(system_code);
revoke all on public.cap_course_systems from anon,authenticated;
grant select on public.cap_course_systems to authenticated;
alter table public.cap_course_systems enable row level security;

create table if not exists public.cap_employee_systems (
  employee_id bigint not null,
  system_code text not null references public.cap_systems(code),
  primary key (employee_id,system_code)
);
create index if not exists cap_employee_systems_system_idx on public.cap_employee_systems(system_code);
revoke all on public.cap_employee_systems from anon,authenticated;
grant select on public.cap_employee_systems to authenticated;
alter table public.cap_employee_systems enable row level security;
create policy cap_employee_systems_read on public.cap_employee_systems for select to authenticated
  using (public.can_view_portal_page('employees') or employee_id=public.cap_employee_id());

create or replace function public.cap_course_matches_systems(target_course uuid,target_employee_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select (target_employee_id=public.cap_employee_id() or public.cap_is_manager()) and
    (not exists(select 1 from public.cap_course_systems cs where cs.course_id=target_course)
    or exists(select 1 from public.cap_course_systems cs
      join public.cap_employee_systems es on es.system_code=cs.system_code
      where cs.course_id=target_course and es.employee_id=target_employee_id));
$$;

create or replace function public.cap_member_enrolled(target_track uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    join public.cap_courses c on c.track_id=t.id
    where e.track_id=target_track and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null and not e.individual_only
      and public.cap_employee_matches_sectors(e.employee_id,t.sectors)
      and public.cap_course_matches_systems(c.id,e.employee_id));
$$;
create or replace function public.cap_owns_enrollment(target_enrollment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cap_enrollments e join public.cap_tracks t on t.id=e.track_id
    where e.id=target_enrollment and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null
      and ((not e.individual_only and public.cap_employee_matches_sectors(e.employee_id,t.sectors)
        and exists(select 1 from public.cap_courses c where c.track_id=t.id
          and public.cap_course_matches_systems(c.id,e.employee_id)))
        or exists(select 1 from public.cap_course_grants g join public.cap_courses c on c.id=g.course_id
          where g.employee_id=e.employee_id and c.track_id=e.track_id)));
$$;
create or replace function public.cap_can_access_course(target_enrollment uuid,target_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    join public.cap_courses c on c.track_id=t.id and c.id=target_course
    where e.id=target_enrollment and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null
      and public.can_view_portal_page('capacitation')
      and ((not e.individual_only and public.cap_employee_matches_sectors(e.employee_id,t.sectors)
        and public.cap_course_matches_systems(c.id,e.employee_id))
        or exists(select 1 from public.cap_course_grants g
          where g.employee_id=e.employee_id and g.course_id=c.id)));
$$;

create or replace function public.cap_enrollment_course_available(target_enrollment uuid,target_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    join public.cap_courses c on c.track_id=t.id and c.id=target_course
    where e.id=target_enrollment and e.removed_at is null and t.deleted_at is null
      and (public.cap_is_manager() or e.employee_id=public.cap_employee_id())
      and (exists(select 1 from public.cap_course_grants g
        where g.employee_id=e.employee_id and g.course_id=c.id)
        or (not e.individual_only and public.cap_employee_matches_sectors(e.employee_id,t.sectors)
          and public.cap_course_matches_systems(c.id,e.employee_id))));
$$;

drop policy if exists cap_courses_read on public.cap_courses;
create policy cap_courses_read on public.cap_courses for select to authenticated
  using (exists(select 1 from public.cap_tracks t where t.id=track_id and t.deleted_at is null)
    and (public.cap_is_manager() or
      (public.cap_member_enrolled(track_id) and public.cap_course_matches_systems(id,public.cap_employee_id()))
      or public.cap_has_course_grant(id)));
drop policy if exists cap_enrollments_read on public.cap_enrollments;
create policy cap_enrollments_read on public.cap_enrollments for select to authenticated
  using (removed_at is null and exists(select 1 from public.cap_tracks t
    where t.id=track_id and t.deleted_at is null
      and (public.cap_is_manager() or (employee_id=public.cap_employee_id()
        and (public.cap_member_enrolled(track_id) or public.cap_has_track_grant(track_id))))));
create policy cap_course_systems_read on public.cap_course_systems for select to authenticated
  using (public.can_edit_portal_data('employees')
    or exists(select 1 from public.cap_courses c where c.id=course_id));

-- A verificação adiada permite ao RPC gravar curso e vínculos na mesma transação.
-- Não percorre cursos anteriores, que permanecem sem classificação.
create or replace function public.cap_require_course_system_v29()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.cap_course_systems cs where cs.course_id=new.id) then
    raise exception 'Selecione o sistema do curso' using errcode='22023'; end if;
  return new;
end;
$$;
drop trigger if exists cap_courses_system_required_v29 on public.cap_courses;
create constraint trigger cap_courses_system_required_v29 after insert on public.cap_courses
  deferrable initially deferred for each row execute function public.cap_require_course_system_v29();

create or replace function public.cap_set_employee_systems(target_employee_id bigint,target_systems text[])
returns void language plpgsql security definer set search_path = '' as $$
declare selected text[] := coalesce(target_systems,'{}'::text[]);
begin
  if not public.can_edit_portal_data('employees') then
    raise exception 'Acesso negado' using errcode='42501'; end if;
  if not public.cap_employee_exists(target_employee_id) then
    raise exception 'Funcionário não encontrado' using errcode='P0002'; end if;
  if cardinality(selected)>2 or array_position(selected,null) is not null
    or (select count(*) from unnest(selected))<>(select count(distinct code) from unnest(selected) as codes(code))
    or exists(select 1 from unnest(selected) as codes(code)
      where not exists(select 1 from public.cap_systems s where s.code=codes.code)) then
    raise exception 'Selecione sistemas válidos' using errcode='22023'; end if;
  insert into public.cap_employee_systems(employee_id,system_code)
    select target_employee_id,code from unnest(selected) as codes(code) on conflict do nothing;
  delete from public.cap_employee_systems es where es.employee_id=target_employee_id
    and not (es.system_code=any(selected));
end;
$$;

create or replace function public.cap_save_course(
  target_course uuid,target_track uuid,course_name text,course_description text,course_url text,
  course_minutes integer,course_modality text,course_order integer,course_certificate_required boolean,
  course_active boolean,target_systems text[],target_employee_ids bigint[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare selected text[] := coalesce(target_systems,'{}'::text[]);
  selected_people bigint[] := coalesce(target_employee_ids,'{}'::bigint[]); saved_id uuid;
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if cardinality(selected) not between 1 and 2 or array_position(selected,null) is not null
    or (select count(*) from unnest(selected))<>(select count(distinct code) from unnest(selected) as codes(code))
    or exists(select 1 from unnest(selected) as codes(code)
      where not exists(select 1 from public.cap_systems s where s.code=codes.code)) then
    raise exception 'Selecione TMS, WMS ou ambos' using errcode='22023'; end if;
  if not exists(select 1 from public.cap_tracks t where t.id=target_track and t.deleted_at is null) then
    raise exception 'Trilha não encontrada' using errcode='P0002'; end if;
  if cardinality(selected_people)>500 or array_position(selected_people,null) is not null
    or (select count(*) from unnest(selected_people))<>(select count(distinct id) from unnest(selected_people) as people(id))
    or exists(select 1 from unnest(selected_people) as people(id)
      where not public.cap_employee_exists(people.id)) then
    raise exception 'Selecione funcionários ativos válidos' using errcode='22023'; end if;
  if target_course is null then
    insert into public.cap_courses(track_id,name,description,external_url,duration_minutes,modality,
      sort_order,certificate_required,active,updated_at)
      values(target_track,course_name,course_description,course_url,course_minutes,course_modality,
        course_order,course_certificate_required,course_active,now()) returning id into saved_id;
  else
    update public.cap_courses set name=course_name,description=course_description,external_url=course_url,
      duration_minutes=course_minutes,modality=course_modality,sort_order=course_order,
      certificate_required=course_certificate_required,active=course_active,updated_at=now()
      where id=target_course and track_id=target_track returning id into saved_id;
    if saved_id is null then raise exception 'Curso não encontrado' using errcode='P0002'; end if;
  end if;
  insert into public.cap_course_systems(course_id,system_code)
    select saved_id,code from unnest(selected) as codes(code) on conflict do nothing;
  delete from public.cap_course_systems cs where cs.course_id=saved_id
    and not (cs.system_code=any(selected));
  insert into public.cap_course_grants(employee_id,course_id,granted_by)
    select id,saved_id,(select auth.uid()) from unnest(selected_people) as people(id)
    on conflict(employee_id,course_id) do nothing;
  delete from public.cap_course_grants g where g.course_id=saved_id
    and public.cap_employee_exists(g.employee_id) and not (g.employee_id=any(selected_people));
  insert into public.cap_enrollments(track_id,employee_id,start_date,due_date,enrolled_by,individual_only)
    select target_track,id,current_date,current_date+t.duration_days,(select auth.uid()),true
    from unnest(selected_people) as people(id) cross join public.cap_tracks t where t.id=target_track
    on conflict(track_id,employee_id) do update set
      individual_only=case when cap_enrollments.removed_at is null
        and not cap_enrollments.individual_only
        and public.cap_employee_matches_sectors(excluded.employee_id,
          (select sectors from public.cap_tracks where id=excluded.track_id))
        then false else true end,
      removed_at=null;
  update public.cap_enrollments e set removed_at=now()
    where e.track_id=target_track and e.individual_only and e.removed_at is null
      and not exists(select 1 from public.cap_course_grants g join public.cap_courses c on c.id=g.course_id
        where g.employee_id=e.employee_id and c.track_id=target_track);
  return saved_id;
end;
$$;

-- O certificado final considera apenas os cursos disponíveis àquela inscrição.
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
            and public.cap_enrollment_course_available(e.id,c.id))
          and not exists(select 1 from public.cap_courses c
            left join public.cap_progress p on p.course_id=c.id and p.enrollment_id=e.id
            where c.track_id=t.id and c.active and p.completed_at is null
              and public.cap_enrollment_course_available(e.id,c.id)))
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
            and public.cap_can_access_course(e.id,p.course_id))));
$$;

create or replace function public.cap_review_track_certificate(target_enrollment uuid,decision text,reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if decision not in ('approved','rejected') or
    (decision='rejected' and char_length(btrim(coalesce(reason,''))) not between 3 and 1000) then
    raise exception 'Informe a decisão e o motivo da rejeição' using errcode='22023'; end if;
  if decision='approved' and exists(select 1 from public.cap_enrollments e
    join public.cap_courses c on c.track_id=e.track_id and c.active
    left join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
    where e.id=target_enrollment and p.completed_at is null
      and public.cap_enrollment_course_available(e.id,c.id)) then
    raise exception 'Conclua todos os cursos disponíveis antes de aprovar' using errcode='22023'; end if;
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
    and (exists(select 1 from public.cap_course_grants g
      where g.employee_id=e.employee_id and g.course_id=c.id)
      or (not e.individual_only and public.cap_course_matches_systems(c.id,e.employee_id))
      or exists(select 1 from public.cap_progress old_progress
        where old_progress.enrollment_id=e.id and old_progress.course_id=c.id
          and (old_progress.started_at is not null or old_progress.completed_at is not null)))
  left join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
  where e.employee_id=target_employee_id
    and (public.cap_is_manager()
      or (public.cap_employee_id()=target_employee_id
        and e.removed_at is null and t.deleted_at is null
        and (public.cap_member_enrolled(t.id) or public.cap_has_track_grant(t.id))))
  order by e.enrolled_at desc,c.sort_order,c.name;
$$;

revoke all on function public.cap_course_matches_systems(uuid,bigint),
  public.cap_enrollment_course_available(uuid,uuid),
  public.cap_set_employee_systems(bigint,text[]),
  public.cap_save_course(uuid,uuid,text,text,text,integer,text,integer,boolean,boolean,text[],bigint[])
  from public,anon;
grant execute on function public.cap_course_matches_systems(uuid,bigint),
  public.cap_enrollment_course_available(uuid,uuid),
  public.cap_set_employee_systems(bigint,text[]),
  public.cap_save_course(uuid,uuid,text,text,text,integer,text,integer,boolean,boolean,text[],bigint[])
  to authenticated;

commit;
