-- V30: classificação por sistema pertence à trilha; cursos herdam sua trilha.
-- A classificação V29 dos cursos existentes é consolidada por trilha.
begin;

alter table public.cap_tracks
  add column if not exists system_codes text[] not null default '{}'::text[];
alter table public.cap_tracks
  add constraint cap_tracks_system_codes_valid_v30 check (
    cardinality(system_codes) <= 2
    and array_position(system_codes,null) is null
    and not (cardinality(system_codes)=2 and system_codes[1]=system_codes[2])
    and system_codes <@ array['TMS','WMS']::text[]
  );
grant update(system_codes) on public.cap_tracks to authenticated;

-- Em trilhas com cursos V29 de sistemas diferentes, usa a união dos códigos.
-- Nenhum curso, inscrição, progresso ou liberação individual é excluído.
update public.cap_tracks t set system_codes=source.codes
from (
  select c.track_id,array_agg(distinct cs.system_code order by cs.system_code) as codes
  from public.cap_course_systems cs
  join public.cap_courses c on c.id=cs.course_id
  group by c.track_id
) source
where source.track_id=t.id and cardinality(t.system_codes)=0;

create or replace function public.cap_require_track_system_v30()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.system_codes)=0 then
    raise exception 'Selecione TMS, WMS ou ambos para a trilha' using errcode='22023';
  end if;
  return new;
end;
$$;
drop trigger if exists cap_tracks_system_required_v30 on public.cap_tracks;
create trigger cap_tracks_system_required_v30 before insert on public.cap_tracks
  for each row execute function public.cap_require_track_system_v30();

-- A exigência de sistema no curso foi substituída pela exigência na trilha.
drop trigger if exists cap_courses_system_required_v29 on public.cap_courses;

create or replace function public.cap_course_matches_systems(target_course uuid,target_employee_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select (target_employee_id=public.cap_employee_id() or public.cap_is_manager())
    and exists(select 1 from public.cap_courses c
      join public.cap_tracks t on t.id=c.track_id
      where c.id=target_course
        and (cardinality(t.system_codes)=0
          or exists(select 1 from public.cap_employee_systems es
            where es.employee_id=target_employee_id and es.system_code=any(t.system_codes))));
$$;

-- Mantém a assinatura V29 para não interromper sessões abertas durante a publicação.
-- target_systems é ignorado: sistema agora é definido exclusivamente na trilha.
create or replace function public.cap_save_course(
  target_course uuid,target_track uuid,course_name text,course_description text,course_url text,
  course_minutes integer,course_modality text,course_order integer,course_certificate_required boolean,
  course_active boolean,target_systems text[],target_employee_ids bigint[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare selected_people bigint[] := coalesce(target_employee_ids,'{}'::bigint[]); saved_id uuid;
begin
  if not public.cap_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
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

commit;
