-- V32: consulta separada de edição; edição auditável e exclusão lógica de avaliações.
-- Execute após a V31. Nenhuma avaliação existente é removida.
begin;

alter table public.perf_assessments add column if not exists last_edited_by uuid references auth.users(id);
alter table public.perf_assessments add column if not exists deleted_at timestamptz;
alter table public.perf_assessments add column if not exists deleted_by uuid references auth.users(id);
create index if not exists perf_assessments_visible_idx on public.perf_assessments(evaluation_date desc) where deleted_at is null;

create or replace function public.perf_can_view()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_users u where u.id=(select auth.uid())
    and u.active and not u.must_change_password
    and (u.access_role='admin' or
      (u.access_role='usuario' and u.allowed_pages @> array['employees','trainings']::text[])));
$$;

drop policy if exists perf_competencies_read on public.perf_competencies;
create policy perf_competencies_read on public.perf_competencies for select to authenticated using (public.perf_can_view());
drop policy if exists perf_models_read on public.perf_models;
create policy perf_models_read on public.perf_models for select to authenticated using (public.perf_can_view());
drop policy if exists perf_model_competencies_read on public.perf_model_competencies;
create policy perf_model_competencies_read on public.perf_model_competencies for select to authenticated using (public.perf_can_view());
drop policy if exists perf_assessments_read on public.perf_assessments;
create policy perf_assessments_read on public.perf_assessments for select to authenticated
  using (deleted_at is null and public.perf_can_view());
drop policy if exists perf_assessment_items_read on public.perf_assessment_items;
create policy perf_assessment_items_read on public.perf_assessment_items for select to authenticated
  using (public.perf_can_view() and exists(select 1 from public.perf_assessments a
    where a.id=assessment_id and a.deleted_at is null));

create table if not exists public.perf_assessment_audit (
  id bigint generated always as identity primary key,
  assessment_id uuid not null references public.perf_assessments(id),
  action text not null check (action in ('edit','delete')),
  previous_data jsonb not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);
alter table public.perf_assessment_audit enable row level security;
revoke all on public.perf_assessment_audit from anon,authenticated;
grant select on public.perf_assessment_audit to authenticated;
drop policy if exists perf_assessment_audit_read on public.perf_assessment_audit;
create policy perf_assessment_audit_read on public.perf_assessment_audit for select to authenticated
  using (public.perf_is_manager());

create or replace function public.perf_guard_deleted_assessment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.deleted_at is not null then
    raise exception 'Avaliação excluída não pode ser alterada' using errcode='42501';
  end if;
  return new;
end;
$$;
drop trigger if exists perf_guard_deleted_assessment on public.perf_assessments;
create trigger perf_guard_deleted_assessment before update on public.perf_assessments
  for each row execute function public.perf_guard_deleted_assessment();

create or replace function public.perf_update_assessment(
  target_id uuid,next_employee_name text,next_department text,next_position text,
  next_admission_date date,next_evaluator text,next_date date,next_scores jsonb,next_finalize boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare assessment public.perf_assessments%rowtype; item record; score_item jsonb;
  score numeric; total_weight numeric;
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  select * into assessment from public.perf_assessments a
    where a.id=target_id and a.deleted_at is null for update;
  if not found then raise exception 'Avaliação não encontrada' using errcode='P0002'; end if;
  if length(btrim(coalesce(next_employee_name,''))) not between 2 and 160
    or length(coalesce(next_department,''))>160 or length(coalesce(next_position,''))>160
    or length(btrim(coalesce(next_evaluator,''))) not between 2 and 160
    or next_date is null or next_scores is null or jsonb_typeof(next_scores)<>'object' then
    raise exception 'Dados da avaliação inválidos' using errcode='22023'; end if;
  insert into public.perf_assessment_audit(assessment_id,action,previous_data,changed_by)
    select target_id,'edit',to_jsonb(assessment)||jsonb_build_object('items',
      (select coalesce(jsonb_agg(to_jsonb(i) order by i.display_order),'[]'::jsonb)
       from public.perf_assessment_items i where i.assessment_id=target_id)),(select auth.uid());
  for item in select * from public.perf_assessment_items i where i.assessment_id=target_id loop
    if not next_scores ? (item.competency_id::text) then
      raise exception 'Informe todas as competências da avaliação' using errcode='22023'; end if;
    score_item:=next_scores->(item.competency_id::text);
    score:=case when score_item='null'::jsonb then null
      when jsonb_typeof(score_item)='number' then (score_item #>> '{}')::numeric
      else null end;
    if (score_item<>'null'::jsonb and score is null) or score<0 or score>100
      or ((assessment.status='finalized' or coalesce(next_finalize,false)) and score is null) then
      raise exception 'A avaliação deve ficar entre 0 e 100 em todas as competências' using errcode='22023'; end if;
    update public.perf_assessment_items set percentage=score,
      weighted_result=case when score is null then null else round(item.weight*score/100,2) end
      where id=item.id;
  end loop;
  select coalesce(sum(i.weight),0) into total_weight from public.perf_assessment_items i where i.assessment_id=target_id;
  if (assessment.status='finalized' or coalesce(next_finalize,false)) and total_weight<>100 then
    raise exception 'Os pesos da avaliação finalizada devem somar 100%%' using errcode='22023'; end if;
  update public.perf_assessments set employee_name=btrim(next_employee_name),
    department=btrim(coalesce(next_department,'')),position_name=btrim(coalesce(next_position,'')),
    admission_date=next_admission_date,evaluator=btrim(next_evaluator),evaluation_date=next_date,
    status=case when coalesce(next_finalize,false) then 'finalized' else assessment.status end,
    finalized_at=case when coalesce(next_finalize,false) then coalesce(assessment.finalized_at,now()) else assessment.finalized_at end,
    final_result=case when assessment.status='finalized' or coalesce(next_finalize,false) then
      (select round(sum(i.weighted_result),2) from public.perf_assessment_items i where i.assessment_id=target_id)
      else null end,
    last_edited_by=(select auth.uid()),updated_at=now()
    where id=target_id;
  return target_id;
end;
$$;

create or replace function public.perf_delete_assessment(target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare assessment public.perf_assessments%rowtype;
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  select * into assessment from public.perf_assessments a
    where a.id=target_id and a.deleted_at is null for update;
  if not found then raise exception 'Avaliação não encontrada' using errcode='P0002'; end if;
  insert into public.perf_assessment_audit(assessment_id,action,previous_data,changed_by)
    select target_id,'delete',to_jsonb(assessment)||jsonb_build_object('items',
      (select coalesce(jsonb_agg(to_jsonb(i) order by i.display_order),'[]'::jsonb)
       from public.perf_assessment_items i where i.assessment_id=target_id)),(select auth.uid());
  update public.perf_assessments set deleted_at=now(),deleted_by=(select auth.uid()),updated_at=now()
    where id=target_id;
end;
$$;

revoke all on function public.perf_can_view(),
  public.perf_update_assessment(uuid,text,text,text,date,text,date,jsonb,boolean),
  public.perf_delete_assessment(uuid) from public,anon;
grant execute on function public.perf_can_view(),
  public.perf_update_assessment(uuid,text,text,text,date,text,date,jsonb,boolean),
  public.perf_delete_assessment(uuid) to authenticated;
commit;
