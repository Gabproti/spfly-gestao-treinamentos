-- V8: trilhas de capacitação, progresso individual e certificados privados.
-- Execute depois da V7. Nenhuma tabela ou registro anterior é removido.

alter table public.admin_users add column if not exists employee_id bigint;
alter table public.admin_users drop constraint if exists admin_users_access_role_check;
alter table public.admin_users add constraint admin_users_access_role_check
  check (access_role in ('admin','rh','usuario','funcionario'));
alter table public.admin_users drop constraint if exists admin_users_allowed_pages_check;
alter table public.admin_users add constraint admin_users_allowed_pages_check
  check (allowed_pages <@ array['dashboard','employees','trainings','reports']::text[]);
alter table public.admin_users add constraint admin_users_employee_role_check
  check (access_role <> 'funcionario' or employee_id is not null);
create unique index if not exists admin_users_employee_id_unique
  on public.admin_users(employee_id) where employee_id is not null;

create or replace function public.can_view_portal_page(page_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users
    where id = (select auth.uid()) and active and not must_change_password
      and (access_role = 'admin'
        or (access_role = 'rh' and page_name in ('employees','trainings','capacitation'))
        or (access_role = 'funcionario' and page_name = 'capacitation')
        or (access_role = 'usuario' and page_name <> 'capacitation' and page_name = any(allowed_pages))));
$$;

create or replace function public.set_portal_access(target_id uuid, next_role text, next_pages text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Somente administradores podem alterar acessos' using errcode = '42501'; end if;
  if target_id = (select auth.uid()) then raise exception 'Não altere o próprio perfil' using errcode = '42501'; end if;
  if next_role not in ('admin','rh','usuario','funcionario') then raise exception 'Perfil inválido' using errcode = '22023'; end if;
  if next_pages is null or not (next_pages <@ array['dashboard','employees','trainings','reports']::text[]) then
    raise exception 'Telas inválidas' using errcode = '22023';
  end if;
  if next_role = 'usuario' and cardinality(next_pages) = 0 then
    raise exception 'Escolha ao menos uma tela' using errcode = '22023';
  end if;
  if next_role = 'funcionario' and not exists
     (select 1 from public.admin_users where id = target_id and employee_id is not null) then
    raise exception 'Vincule a conta a um funcionário antes de usar este perfil' using errcode = '22023';
  end if;
  update public.admin_users set access_role = next_role,
    allowed_pages = case when next_role = 'usuario' then next_pages else '{}'::text[] end,
    employee_id = case when next_role = 'funcionario' then employee_id else null end
    where id = target_id and active;
  if not found then raise exception 'Conta não encontrada' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.cap_is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where id = (select auth.uid())
    and active and not must_change_password and access_role in ('admin','rh'));
$$;
create or replace function public.cap_employee_id()
returns bigint language sql stable security definer set search_path = '' as $$
  select employee_id from public.admin_users where id = (select auth.uid())
    and active and not must_change_password and access_role = 'funcionario';
$$;
create or replace function public.cap_employee_exists(target_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_state s,
    jsonb_array_elements(s.employees) as employee(item)
    where s.id = 1 and employee.item->>'id' = target_id::text
      and coalesce(employee.item->>'status','Ativo') <> 'Inativo');
$$;

create table if not exists public.cap_tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 3 and 160),
  description text not null default '',
  track_type text not null check (track_type in ('Obrigatória','Recomendada','Opcional')),
  duration_days integer not null check (duration_days between 1 and 3650),
  start_date date not null,
  status text not null default 'Ativa' check (status in ('Ativa','Concluída','Encerrada')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.cap_courses (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.cap_tracks(id),
  name text not null check (char_length(btrim(name)) between 3 and 160),
  description text not null default '',
  external_url text not null check (external_url ~* '^https?://[^[:space:]]+$' and char_length(external_url) <= 2000),
  duration_minutes integer not null check (duration_minutes between 1 and 100000),
  sort_order integer not null check (sort_order > 0),
  certificate_required boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cap_courses_track_order_idx on public.cap_courses(track_id,sort_order);
create table if not exists public.cap_enrollments (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.cap_tracks(id),
  employee_id bigint not null,
  start_date date not null,
  due_date date not null,
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid not null default auth.uid() references auth.users(id),
  unique(track_id,employee_id),
  check (due_date >= start_date)
);
create index if not exists cap_enrollments_employee_idx on public.cap_enrollments(employee_id);
create table if not exists public.cap_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.cap_enrollments(id),
  course_id uuid not null references public.cap_courses(id),
  started_at timestamptz,
  completed_at timestamptz,
  certificate_path text,
  certificate_name text,
  certificate_uploaded_at timestamptz,
  certificate_viewed_at timestamptz,
  unique(enrollment_id,course_id)
);
create index if not exists cap_progress_enrollment_idx on public.cap_progress(enrollment_id);

create or replace function public.cap_member_enrolled(target_track uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cap_enrollments e
    where e.track_id = target_track and e.employee_id = public.cap_employee_id());
$$;
create or replace function public.cap_owns_enrollment(target_enrollment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cap_enrollments e
    where e.id = target_enrollment and e.employee_id = public.cap_employee_id());
$$;

alter table public.cap_tracks enable row level security;
alter table public.cap_courses enable row level security;
alter table public.cap_enrollments enable row level security;
alter table public.cap_progress enable row level security;
revoke all on public.cap_tracks,public.cap_courses,public.cap_enrollments,public.cap_progress from anon,authenticated;
grant select on public.cap_tracks,public.cap_courses,public.cap_enrollments,public.cap_progress to authenticated;
grant insert on public.cap_tracks,public.cap_courses to authenticated;
grant update(name,description,track_type,duration_days,start_date,status,updated_at)
  on public.cap_tracks to authenticated;
grant update(name,description,external_url,duration_minutes,sort_order,certificate_required,active,updated_at)
  on public.cap_courses to authenticated;
grant insert on public.cap_enrollments to authenticated;

create policy cap_tracks_read on public.cap_tracks for select to authenticated
  using (public.cap_is_manager() or public.cap_member_enrolled(id));
create policy cap_tracks_insert on public.cap_tracks for insert to authenticated
  with check (public.cap_is_manager() and created_by = (select auth.uid()));
create policy cap_tracks_update on public.cap_tracks for update to authenticated
  using (public.cap_is_manager()) with check (public.cap_is_manager());
create policy cap_courses_read on public.cap_courses for select to authenticated
  using (public.cap_is_manager() or public.cap_member_enrolled(track_id));
create policy cap_courses_insert on public.cap_courses for insert to authenticated
  with check (public.cap_is_manager());
create policy cap_courses_update on public.cap_courses for update to authenticated
  using (public.cap_is_manager()) with check (public.cap_is_manager());
create policy cap_enrollments_read on public.cap_enrollments for select to authenticated
  using (public.cap_is_manager() or employee_id = public.cap_employee_id());
create policy cap_enrollments_insert on public.cap_enrollments for insert to authenticated
  with check (public.cap_is_manager() and public.cap_employee_exists(employee_id)
    and enrolled_by = (select auth.uid()) and exists
      (select 1 from public.cap_tracks t where t.id = track_id));
create policy cap_progress_read on public.cap_progress for select to authenticated
  using (public.cap_is_manager() or public.cap_owns_enrollment(enrollment_id));

create or replace function public.cap_set_course_state(target_enrollment uuid,target_course uuid,next_state text)
returns void language plpgsql security definer set search_path = '' as $$
declare track_status text; course_active boolean;
begin
  if not public.cap_owns_enrollment(target_enrollment) then
    raise exception 'Inscrição não autorizada' using errcode = '42501';
  end if;
  select t.status,c.active into track_status,course_active
    from public.cap_enrollments e join public.cap_tracks t on t.id=e.track_id
    join public.cap_courses c on c.track_id=t.id
    where e.id=target_enrollment and c.id=target_course;
  if track_status is null or track_status <> 'Ativa' or not course_active then
    raise exception 'Curso indisponível' using errcode = '22023';
  end if;
  if next_state = 'started' then
    insert into public.cap_progress(enrollment_id,course_id,started_at)
      values(target_enrollment,target_course,now())
      on conflict (enrollment_id,course_id) do update
        set started_at=coalesce(cap_progress.started_at,excluded.started_at);
  elsif next_state = 'completed' then
    insert into public.cap_progress(enrollment_id,course_id,started_at,completed_at)
      values(target_enrollment,target_course,now(),now())
      on conflict (enrollment_id,course_id) do update
        set started_at=coalesce(cap_progress.started_at,excluded.started_at),
            completed_at=coalesce(cap_progress.completed_at,excluded.completed_at);
  else
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.cap_can_read_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.cap_is_manager() or exists
    (select 1 from public.cap_enrollments e where e.id::text=split_part(object_path,'/',1)
      and e.employee_id=public.cap_employee_id());
$$;
create or replace function public.cap_can_upload_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select object_path ~* '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(pdf|jpe?g|png)$'
    and exists (select 1 from public.cap_enrollments e
      join public.cap_progress p on p.enrollment_id=e.id
      join public.cap_courses c on c.id=p.course_id and c.track_id=e.track_id
      where e.id::text=split_part(object_path,'/',1)
        and c.id::text=split_part(object_path,'/',2)
        and e.employee_id=public.cap_employee_id()
        and p.completed_at is not null and p.certificate_path is null
        and c.certificate_required);
$$;

insert into storage.buckets(id,name,public,file_size_limit)
values('cap-certificates','cap-certificates',false,10485760)
on conflict (id) do nothing;
create policy cap_certificates_read on storage.objects for select to authenticated
  using (bucket_id='cap-certificates' and public.cap_can_read_certificate(name));
create policy cap_certificates_insert on storage.objects for insert to authenticated
  with check (bucket_id='cap-certificates' and public.cap_can_upload_certificate(name));

create or replace function public.cap_attach_certificate(target_enrollment uuid,target_course uuid,object_path text,file_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_owns_enrollment(target_enrollment)
     or not public.cap_can_upload_certificate(object_path)
     or split_part(object_path,'/',1) <> target_enrollment::text
     or split_part(object_path,'/',2) <> target_course::text
     or char_length(btrim(file_name)) not between 1 and 200
     or not exists(select 1 from storage.objects where bucket_id='cap-certificates' and name=object_path)
  then raise exception 'Certificado inválido ou não autorizado' using errcode = '42501'; end if;
  update public.cap_progress set certificate_path=object_path,
    certificate_name=file_name,certificate_uploaded_at=now()
    where enrollment_id=target_enrollment and course_id=target_course
      and completed_at is not null and certificate_path is null;
  if not found then raise exception 'Conclusão não encontrada' using errcode = '22023'; end if;
end;
$$;
create or replace function public.cap_mark_certificate_viewed(target_progress uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update public.cap_progress set certificate_viewed_at=coalesce(certificate_viewed_at,now())
    where id=target_progress and certificate_path is not null;
  if not found then raise exception 'Certificado não encontrado' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.cap_is_manager(),public.cap_employee_id(),public.cap_employee_exists(bigint),
  public.cap_member_enrolled(uuid),public.cap_owns_enrollment(uuid),
  public.cap_set_course_state(uuid,uuid,text),public.cap_can_read_certificate(text),
  public.cap_can_upload_certificate(text),public.cap_attach_certificate(uuid,uuid,text,text),
  public.cap_mark_certificate_viewed(uuid) from public,anon;
grant execute on function public.cap_is_manager(),public.cap_employee_id(),public.cap_employee_exists(bigint),
  public.cap_member_enrolled(uuid),public.cap_owns_enrollment(uuid),
  public.cap_set_course_state(uuid,uuid,text),public.cap_can_read_certificate(text),
  public.cap_can_upload_certificate(text),public.cap_attach_certificate(uuid,uuid,text,text),
  public.cap_mark_certificate_viewed(uuid) to authenticated;
