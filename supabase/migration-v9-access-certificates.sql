-- V9: dois perfis, permissões por tela e conferência de certificados.
-- Execute uma vez depois da V8. Os dados existentes são preservados.

alter table public.admin_users add column if not exists editable_pages text[] not null default '{}'::text[];
alter table public.admin_users drop constraint if exists admin_users_access_role_check;
alter table public.admin_users drop constraint if exists admin_users_allowed_pages_check;
alter table public.admin_users add constraint admin_users_allowed_pages_check
  check (allowed_pages <@ array['dashboard','employees','trainings','reports','capacitation']::text[]);
alter table public.admin_users add constraint admin_users_editable_pages_check
  check (editable_pages <@ array['employees','trainings','capacitation']::text[] and editable_pages <@ allowed_pages);
alter table public.admin_users drop constraint if exists admin_users_employee_role_check;

-- Conserva os acessos existentes ao trocar os nomes dos perfis.
update public.admin_users set
  editable_pages = case
    when access_role = 'rh' then array['employees','trainings']::text[]
    when access_role = 'funcionario' then array['capacitation']::text[]
    when access_role = 'usuario' then array(select unnest(allowed_pages) intersect select unnest(array['employees','trainings']::text[]))
    else '{}'::text[] end,
  allowed_pages = case
    when access_role = 'rh' then array['employees','trainings']::text[]
    when access_role = 'funcionario' then array['capacitation']::text[]
    else allowed_pages end,
  access_role = case when access_role in ('rh','funcionario') then 'usuario' else access_role end;
alter table public.admin_users add constraint admin_users_access_role_check
  check (access_role in ('admin','usuario'));

create or replace function public.can_view_portal_page(page_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where id=(select auth.uid())
    and active and not must_change_password
    and (access_role='admin' or (access_role='usuario' and page_name=any(allowed_pages))));
$$;
create or replace function public.can_edit_portal_data(data_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where id=(select auth.uid())
    and active and not must_change_password
    and (access_role='admin' or (access_role='usuario' and data_name=any(editable_pages))));
$$;

create or replace function public.load_portal_state()
returns table(version bigint, employees jsonb, trainings jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_pages text[]; v_employee_id bigint;
  v_employees jsonb; v_trainings jsonb; v_version bigint;
begin
  select access_role,allowed_pages,employee_id into v_role,v_pages,v_employee_id
    from public.admin_users where id=(select auth.uid()) and active and not must_change_password;
  if v_role is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  select s.version,s.employees,s.trainings into v_version,v_employees,v_trainings
    from public.app_state s where s.id=1;
  version:=v_version;
  if v_role='admin' or 'reports'=any(v_pages)
     or ('employees'=any(v_pages) and 'trainings'=any(v_pages)) then
    employees:=v_employees; trainings:=v_trainings;
  elsif 'employees'=any(v_pages) then
    employees:=v_employees;
    select coalesce(jsonb_agg(jsonb_build_object('id',item->'id','date',item->'date',
      'name',item->'name','participants',coalesce(item->'participants','[]'::jsonb))), '[]'::jsonb)
      into trainings from jsonb_array_elements(v_trainings) t(item);
  elsif 'trainings'=any(v_pages) then
    trainings:=v_trainings;
    select coalesce(jsonb_agg(jsonb_build_object('id',item->'id','mat',item->'mat',
      'name',item->'name','sector',item->'sector','role',item->'role','status',item->'status')),'[]'::jsonb)
      into employees from jsonb_array_elements(v_employees) t(item);
  elsif 'dashboard'=any(v_pages) then
    employees:='[]'::jsonb;
    select coalesce(jsonb_agg((item - 'participants' - 'docs' - 'doc' - 'docFiles'
      - 'contentDocs' - 'contentDoc' - 'contentFiles' - 'docData' - 'contentData'
      - 'obs' - 'desc' - 'resp' - 'cancelReason' - 'statusChanges') ||
      jsonb_build_object('participantCount',jsonb_array_length(coalesce(item->'participants','[]'::jsonb)))),'[]'::jsonb)
      into trainings from jsonb_array_elements(v_trainings) t(item);
  else
    employees:='[]'::jsonb; trainings:='[]'::jsonb;
  end if;
  return next;
end;
$$;

drop function public.set_portal_access(uuid,text,text[]);
create function public.set_portal_access(target_id uuid,next_role text,next_pages text[],next_edits text[],next_employee_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Somente administradores podem alterar acessos' using errcode='42501'; end if;
  if target_id=(select auth.uid()) then raise exception 'Não altere o próprio perfil' using errcode='42501'; end if;
  if next_role not in ('admin','usuario') then raise exception 'Perfil inválido' using errcode='22023'; end if;
  if next_pages is null or not next_pages <@ array['dashboard','employees','trainings','reports','capacitation']::text[]
     or next_edits is null or not next_edits <@ array['employees','trainings','capacitation']::text[]
     or not next_edits <@ next_pages then raise exception 'Permissões inválidas' using errcode='22023'; end if;
  if next_role='usuario' and cardinality(next_pages)=0 then raise exception 'Escolha ao menos uma tela' using errcode='22023'; end if;
  if next_role='usuario' and 'capacitation'=any(next_pages) and
     (next_employee_id is null or not public.cap_employee_exists(next_employee_id)) then
    raise exception 'Vincule a conta a um funcionário para acessar Capacitação' using errcode='22023'; end if;
  update public.admin_users set access_role=next_role,
    allowed_pages=case when next_role='usuario' then next_pages else '{}'::text[] end,
    editable_pages=case when next_role='usuario' then next_edits else '{}'::text[] end,
    employee_id=case when next_role='usuario' and 'capacitation'=any(next_pages) then next_employee_id else null end
    where id=target_id and active;
  if not found then raise exception 'Conta não encontrada' using errcode='P0002'; end if;
end;
$$;
revoke all on function public.set_portal_access(uuid,text,text[],text[],bigint) from public,anon;
grant execute on function public.set_portal_access(uuid,text,text[],text[],bigint) to authenticated;

create or replace function public.cap_is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_users where id=(select auth.uid())
    and active and not must_change_password and access_role='admin');
$$;
create or replace function public.cap_employee_id()
returns bigint language sql stable security definer set search_path = '' as $$
  select employee_id from public.admin_users where id=(select auth.uid())
    and active and not must_change_password and access_role='usuario'
    and 'capacitation'=any(allowed_pages);
$$;

-- Usuários não podem marcar cursos como concluídos sem conferência.
create or replace function public.cap_set_course_state(target_enrollment uuid,target_course uuid,next_state text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() or next_state <> 'completed' then
    raise exception 'Somente administradores podem confirmar a conclusão' using errcode='42501'; end if;
  if not exists(select 1 from public.cap_enrollments e join public.cap_courses c on c.track_id=e.track_id
    where e.id=target_enrollment and c.id=target_course) then
    raise exception 'Curso não pertence à inscrição' using errcode='22023'; end if;
  insert into public.cap_progress(enrollment_id,course_id,started_at,completed_at)
    values(target_enrollment,target_course,now(),now())
    on conflict(enrollment_id,course_id) do update
      set started_at=coalesce(cap_progress.started_at,excluded.started_at),
          completed_at=coalesce(cap_progress.completed_at,excluded.completed_at);
end;
$$;

alter table public.cap_progress add column if not exists validation_status text not null default 'pending';
alter table public.cap_progress add column if not exists rejection_reason text;
alter table public.cap_progress add column if not exists validated_by uuid references auth.users(id);
alter table public.cap_progress add column if not exists validated_at timestamptz;
alter table public.cap_progress add constraint cap_progress_validation_status_check
  check(validation_status in ('pending','approved','rejected'));
-- Conclusões antigas de cursos com certificado aguardam a primeira conferência.
update public.cap_progress p set completed_at=null
  from public.cap_courses c where c.id=p.course_id and c.certificate_required and p.completed_at is not null;

create or replace function public.cap_can_upload_certificate(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select object_path ~* '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(pdf|jpe?g|png)$'
    and exists(select 1 from public.cap_enrollments e
      join public.cap_tracks t on t.id=e.track_id and t.status='Ativa'
      join public.cap_courses c on c.track_id=e.track_id
      left join public.cap_progress p on p.enrollment_id=e.id and p.course_id=c.id
      where e.id::text=split_part(object_path,'/',1)
        and c.id::text=split_part(object_path,'/',2)
        and e.employee_id=public.cap_employee_id()
        and public.can_view_portal_page('capacitation')
        and exists(select 1 from public.admin_users a where a.id=(select auth.uid())
          and 'capacitation'=any(a.editable_pages))
        and c.active and c.certificate_required
        and (p.certificate_path is null or p.validation_status='rejected'));
$$;

create or replace function public.cap_attach_certificate(target_enrollment uuid,target_course uuid,object_path text,file_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_can_upload_certificate(object_path)
     or split_part(object_path,'/',1)<>target_enrollment::text
     or split_part(object_path,'/',2)<>target_course::text
     or char_length(btrim(file_name)) not between 1 and 200
     or not exists(select 1 from storage.objects where bucket_id='cap-certificates' and name=object_path)
  then raise exception 'Certificado inválido ou não autorizado' using errcode='42501'; end if;
  insert into public.cap_progress(enrollment_id,course_id,certificate_path,certificate_name,certificate_uploaded_at,validation_status)
    values(target_enrollment,target_course,object_path,file_name,now(),'pending')
    on conflict(enrollment_id,course_id) do update set
      certificate_path=excluded.certificate_path,certificate_name=excluded.certificate_name,
      certificate_uploaded_at=excluded.certificate_uploaded_at,validation_status='pending',
      rejection_reason=null,validated_by=null,validated_at=null,certificate_viewed_at=null
    where cap_progress.certificate_path is null or cap_progress.validation_status='rejected';
  if not found then raise exception 'Certificado pendente ou aprovado não pode ser substituído' using errcode='42501'; end if;
end;
$$;

create or replace function public.cap_review_certificate(target_progress uuid,decision text,reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if decision not in ('approved','rejected') or (decision='rejected' and char_length(btrim(coalesce(reason,'')))<3) then
    raise exception 'Informe a decisão e o motivo da rejeição' using errcode='22023'; end if;
  if decision='approved' and not exists(select 1 from public.cap_progress
    where id=target_progress and certificate_viewed_at is not null) then
    raise exception 'Abra o certificado antes de aprová-lo' using errcode='22023'; end if;
  update public.cap_progress set validation_status=decision,
    rejection_reason=case when decision='rejected' then btrim(reason) else null end,
    validated_by=(select auth.uid()),validated_at=now(),
    completed_at=case when decision='approved' then coalesce(completed_at,now()) else completed_at end,
    started_at=case when decision='approved' then coalesce(started_at,now()) else started_at end
    where id=target_progress and certificate_path is not null and validation_status='pending';
  if not found then raise exception 'Certificado não encontrado ou já avaliado' using errcode='P0002'; end if;
end;
$$;
revoke all on function public.cap_review_certificate(uuid,text,text) from public,anon;
grant execute on function public.cap_review_certificate(uuid,text,text) to authenticated;
