-- V25: certificados externos e anexos gerais vinculados ao cadastro existente de funcionários.
-- Execute após a V24. Os arquivos permanecem em bucket privado.
begin;

create or replace function public.employee_record_exists(target_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_state s,
    jsonb_array_elements(s.employees) as employee(item)
    where s.id = 1 and employee.item->>'id' = target_id::text);
$$;

create table if not exists public.employee_certificates (
  id uuid primary key default gen_random_uuid(),
  employee_id bigint not null,
  course_name text not null check (char_length(btrim(course_name)) between 2 and 200),
  institution text not null check (char_length(btrim(institution)) between 2 and 200),
  completed_on date not null,
  expires_on date check (expires_on is null or expires_on >= completed_on),
  workload_hours numeric(7,2) check (workload_hours is null or workload_hours > 0),
  category text not null default '' check (char_length(category) <= 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  file_path text not null unique,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_certificates_path_check check
    (file_path ~ '^[0-9]+/[a-f0-9-]{36}/[a-f0-9-]{36}[.](pdf|jpg|jpeg|png)$'
      and split_part(file_path, '/', 1) = employee_id::text)
);
create index if not exists employee_certificates_employee_idx
  on public.employee_certificates(employee_id, completed_on desc);
alter table public.employee_certificates enable row level security;

create policy employee_certificates_read on public.employee_certificates
  for select to authenticated
  using (public.can_view_portal_page('employees'));
create policy employee_certificates_insert on public.employee_certificates
  for insert to authenticated
  with check (public.can_edit_portal_data('employees')
    and public.employee_record_exists(employee_id)
    and created_by = (select auth.uid()));
create policy employee_certificates_update on public.employee_certificates
  for update to authenticated
  using (public.can_edit_portal_data('employees'))
  with check (public.can_edit_portal_data('employees')
    and public.employee_record_exists(employee_id));
create policy employee_certificates_delete on public.employee_certificates
  for delete to authenticated
  using (public.can_edit_portal_data('employees'));
grant select, insert, update, delete on public.employee_certificates to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('employee-certificates', 'employee-certificates', false, 10485760,
  array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

create policy employee_cert_files_read on storage.objects for select to authenticated
  using (bucket_id = 'employee-certificates'
    and public.can_view_portal_page('employees'));
create policy employee_cert_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-certificates'
    and public.can_edit_portal_data('employees')
    and case when name ~ '^[0-9]+/[a-f0-9-]{36}/[a-f0-9-]{36}[.](pdf|jpg|jpeg|png)$'
      then public.employee_record_exists(split_part(name, '/', 1)::bigint)
      else false end);
create policy employee_cert_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-certificates'
    and public.can_edit_portal_data('employees'));

create table if not exists public.employee_attachments (
  id uuid primary key default gen_random_uuid(),
  employee_id bigint not null,
  title text not null check (char_length(btrim(title)) between 2 and 200),
  category text not null default '' check (char_length(category) <= 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  file_path text not null unique,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime_type text not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_attachments_path_check check
    (file_path ~ '^[0-9]+/[a-f0-9-]{36}/[a-f0-9-]{36}[.](pdf|jpg|jpeg|png|docx|xlsx|txt)$'
      and split_part(file_path, '/', 1) = employee_id::text)
);
create index if not exists employee_attachments_employee_idx
  on public.employee_attachments(employee_id, created_at desc);
alter table public.employee_attachments enable row level security;

create policy employee_attachments_read on public.employee_attachments
  for select to authenticated
  using (public.can_view_portal_page('employees'));
create policy employee_attachments_insert on public.employee_attachments
  for insert to authenticated
  with check (public.can_edit_portal_data('employees')
    and public.employee_record_exists(employee_id)
    and created_by = (select auth.uid()));
create policy employee_attachments_update on public.employee_attachments
  for update to authenticated
  using (public.can_edit_portal_data('employees'))
  with check (public.can_edit_portal_data('employees')
    and public.employee_record_exists(employee_id));
create policy employee_attachments_delete on public.employee_attachments
  for delete to authenticated
  using (public.can_edit_portal_data('employees'));
grant select, insert, update, delete on public.employee_attachments to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('employee-attachments', 'employee-attachments', false, 10485760,
  array['application/pdf','image/jpeg','image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

create policy employee_attach_files_read on storage.objects for select to authenticated
  using (bucket_id = 'employee-attachments'
    and public.can_view_portal_page('employees'));
create policy employee_attach_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-attachments'
    and public.can_edit_portal_data('employees')
    and case when name ~ '^[0-9]+/[a-f0-9-]{36}/[a-f0-9-]{36}[.](pdf|jpg|jpeg|png|docx|xlsx|txt)$'
      then public.employee_record_exists(split_part(name, '/', 1)::bigint)
      else false end);
create policy employee_attach_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-attachments'
    and public.can_edit_portal_data('employees'));

-- O funcionário continua podendo ler o próprio certificado já registrado,
-- mesmo que seu setor tenha sido alterado depois da inscrição.
create or replace function public.cap_can_read_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.cap_is_manager() or exists(
    select 1 from public.cap_enrollments e
    join public.cap_tracks t on t.id=e.track_id
    where e.id::text=split_part(object_path,'/',1)
      and e.employee_id=public.cap_employee_id()
      and e.removed_at is null and t.deleted_at is null
      and (e.track_certificate_path=object_path or exists(
        select 1 from public.cap_progress p
        where p.enrollment_id=e.id and p.certificate_path=object_path)));
$$;

revoke all on function public.employee_record_exists(bigint) from public, anon;
grant execute on function public.employee_record_exists(bigint) to authenticated;
commit;
