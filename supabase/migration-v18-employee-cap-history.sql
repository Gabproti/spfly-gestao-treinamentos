-- V18: histórico de capacitações para a ficha do funcionário.
-- Administradores veem também trilhas e inscrições removidas; o funcionário vê apenas as suas inscrições ativas.
create or replace function public.cap_employee_history(target_employee_id bigint)
returns table (
  enrollment_id uuid,
  enrollment_start date,
  enrollment_due date,
  enrolled_at timestamptz,
  removed_at timestamptz,
  track_id uuid,
  track_name text,
  track_type text,
  track_status text,
  track_deleted_at timestamptz,
  course_id uuid,
  course_name text,
  course_active boolean,
  course_order integer,
  certificate_required boolean,
  started_at timestamptz,
  course_finished_at timestamptz,
  completed_at timestamptz,
  certificate_path text,
  certificate_name text,
  certificate_uploaded_at timestamptz,
  validation_status text,
  rejection_reason text
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
        and e.removed_at is null and t.deleted_at is null))
  order by e.enrolled_at desc,c.sort_order,c.name;
$$;

revoke all on function public.cap_employee_history(bigint) from public,anon;
grant execute on function public.cap_employee_history(bigint) to authenticated;
