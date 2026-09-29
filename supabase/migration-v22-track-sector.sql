-- V22: setor destinatário da trilha. Valor vazio significa todos os setores.
-- Execute depois da V18. Trilhas existentes continuam disponíveis a todos.
begin;
alter table public.cap_tracks add column if not exists sector text not null default '';
alter table public.cap_tracks drop constraint if exists cap_tracks_sector_check;
alter table public.cap_tracks add constraint cap_tracks_sector_check
  check (sector = btrim(sector) and char_length(sector) <= 120);
grant update(sector) on public.cap_tracks to authenticated;

create or replace function public.cap_employee_matches_sector(target_employee_id bigint,target_sector text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(target_sector,'') = '' or exists (
    select 1 from public.app_state s,
      jsonb_array_elements(s.employees) as employee(item)
    where s.id = 1 and employee.item->>'id' = target_employee_id::text
      and employee.item->>'sector' = target_sector);
$$;

create or replace function public.cap_member_enrolled(target_track uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    where e.track_id=target_track and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null
      and public.cap_employee_matches_sector(e.employee_id,t.sector));
$$;

create or replace function public.cap_owns_enrollment(target_enrollment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    where e.id=target_enrollment and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null
      and public.cap_employee_matches_sector(e.employee_id,t.sector));
$$;

drop policy if exists cap_enrollments_read on public.cap_enrollments;
create policy cap_enrollments_read on public.cap_enrollments for select to authenticated
  using (removed_at is null and exists (select 1 from public.cap_tracks t
    where t.id=track_id and t.deleted_at is null
      and (public.cap_is_manager() or
        (employee_id=public.cap_employee_id() and
         public.cap_employee_matches_sector(employee_id,t.sector)))));

drop policy if exists cap_enrollments_insert on public.cap_enrollments;
create policy cap_enrollments_insert on public.cap_enrollments for insert to authenticated
  with check (public.cap_is_manager() and removed_at is null
    and public.cap_employee_exists(employee_id) and enrolled_by=(select auth.uid())
    and exists (select 1 from public.cap_tracks t
      where t.id=track_id and t.deleted_at is null
        and public.cap_employee_matches_sector(employee_id,t.sector)));

create or replace function public.cap_check_track_sector_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.sector is distinct from old.sector and new.sector <> ''
     and exists (select 1 from public.cap_enrollments e
       where e.track_id=new.id and e.removed_at is null
         and not public.cap_employee_matches_sector(e.employee_id,new.sector)) then
    raise exception 'Remova os funcionários de outros setores antes de alterar o setor da trilha'
      using errcode='22023';
  end if;
  return new;
end;
$$;
drop trigger if exists cap_track_sector_change on public.cap_tracks;
create trigger cap_track_sector_change before update of sector on public.cap_tracks
  for each row execute function public.cap_check_track_sector_change();

create or replace function public.cap_enroll_employees(target_track uuid,target_employee_ids bigint[])
returns void language plpgsql security definer set search_path = '' as $$
declare target_start date; target_days integer; target_sector text;
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if coalesce(array_length(target_employee_ids,1),0) not between 1 and 500
     or exists (select 1 from unnest(target_employee_ids) as ids(employee_id)
       where employee_id is null or not public.cap_employee_exists(employee_id)) then
    raise exception 'Selecione funcionários válidos' using errcode='22023';
  end if;
  select start_date,duration_days,sector into target_start,target_days,target_sector
    from public.cap_tracks where id=target_track and deleted_at is null;
  if not found then raise exception 'Trilha não encontrada' using errcode='P0002'; end if;
  if exists (select 1 from unnest(target_employee_ids) as ids(employee_id)
    where not public.cap_employee_matches_sector(employee_id,target_sector)) then
    raise exception 'Selecione apenas funcionários do setor destinatário' using errcode='22023';
  end if;
  insert into public.cap_enrollments(track_id,employee_id,start_date,due_date,enrolled_by,removed_at)
    select target_track,id,target_start,target_start+target_days,(select auth.uid()),null
    from (select distinct unnest(target_employee_ids) as id) people
    on conflict(track_id,employee_id) do update set
      removed_at=null,start_date=excluded.start_date,due_date=excluded.due_date,
      enrolled_at=now(),enrolled_by=excluded.enrolled_by;
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
        and public.cap_employee_matches_sector(e.employee_id,t.sector)
        and public.can_view_portal_page('capacitation')
        and exists(select 1 from public.admin_users a where a.id=(select auth.uid())
          and 'capacitation'=any(a.editable_pages))
        and c.active and c.certificate_required and p.course_finished_at is not null
        and (p.certificate_path is null or p.validation_status='rejected'));
$$;

create or replace function public.cap_can_read_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.cap_is_manager() or exists(select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    where e.id::text=split_part(object_path,'/',1)
      and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null
      and public.cap_employee_matches_sector(e.employee_id,t.sector));
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
  left join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
  where e.employee_id=target_employee_id
    and (public.cap_is_manager()
      or (public.cap_employee_id()=target_employee_id
        and e.removed_at is null and t.deleted_at is null
        and public.cap_employee_matches_sector(e.employee_id,t.sector)))
  order by e.enrolled_at desc,c.sort_order,c.name;
$$;

commit;

