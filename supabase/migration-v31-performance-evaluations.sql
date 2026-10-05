-- V31: avaliações de desempenho. Execute após a V30.
begin;

create or replace function public.perf_is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_users u where u.id=(select auth.uid())
    and u.active and not u.must_change_password
    and (u.access_role='admin' or
      (u.access_role='usuario' and u.editable_pages @> array['employees','trainings']::text[])));
$$;

create table if not exists public.perf_competencies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  meaning text not null check (length(btrim(meaning)) between 2 and 2000),
  max_weight numeric(5,2) not null check (max_weight > 0 and max_weight <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.perf_models (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 3 and 160),
  audience text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.perf_model_competencies (
  model_id uuid not null references public.perf_models(id),
  competency_id uuid not null references public.perf_competencies(id),
  display_order integer not null check (display_order > 0),
  created_at timestamptz not null default now(),
  primary key(model_id,competency_id),
  unique(model_id,display_order)
);
create table if not exists public.perf_assessments (
  id uuid primary key default gen_random_uuid(),
  model_id uuid references public.perf_models(id),
  employee_id bigint not null,
  employee_name text not null,
  department text not null default '',
  position_name text not null default '',
  admission_date date,
  model_name text not null,
  evaluator text not null,
  evaluation_date date not null,
  status text not null default 'draft' check (status in ('draft','finalized')),
  final_result numeric(5,2),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  check ((status='draft' and finalized_at is null) or
         (status='finalized' and finalized_at is not null and final_result between 0 and 100))
);
create index if not exists perf_assessments_employee_idx on public.perf_assessments(employee_id,evaluation_date desc);
create table if not exists public.perf_assessment_items (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.perf_assessments(id) on delete cascade,
  competency_id uuid references public.perf_competencies(id),
  competency_name text not null,
  meaning text not null,
  weight numeric(5,2) not null check(weight > 0 and weight <= 100),
  percentage numeric(5,2) check(percentage between 0 and 100),
  weighted_result numeric(5,2),
  display_order integer not null,
  unique(assessment_id,display_order)
);

insert into public.perf_models(name,audience) values
  ('Avaliação de Desempenho — Lideranças','Lideranças'),
  ('Avaliação de Desempenho — Administrativo','Administrativo'),
  ('Avaliação de Desempenho — Operacional','Operacional')
on conflict(name) do nothing;

alter table public.perf_competencies enable row level security;
alter table public.perf_models enable row level security;
alter table public.perf_model_competencies enable row level security;
alter table public.perf_assessments enable row level security;
alter table public.perf_assessment_items enable row level security;
revoke all on public.perf_competencies,public.perf_models,public.perf_model_competencies,
  public.perf_assessments,public.perf_assessment_items from anon,authenticated;
grant select on public.perf_competencies,public.perf_models,public.perf_model_competencies,
  public.perf_assessments,public.perf_assessment_items to authenticated;
drop policy if exists perf_competencies_read on public.perf_competencies;
create policy perf_competencies_read on public.perf_competencies for select to authenticated using (public.perf_is_manager());
drop policy if exists perf_models_read on public.perf_models;
create policy perf_models_read on public.perf_models for select to authenticated using (public.perf_is_manager());
drop policy if exists perf_model_competencies_read on public.perf_model_competencies;
create policy perf_model_competencies_read on public.perf_model_competencies for select to authenticated using (public.perf_is_manager());
drop policy if exists perf_assessments_read on public.perf_assessments;
create policy perf_assessments_read on public.perf_assessments for select to authenticated using (public.perf_is_manager());
drop policy if exists perf_assessment_items_read on public.perf_assessment_items;
create policy perf_assessment_items_read on public.perf_assessment_items for select to authenticated using (public.perf_is_manager());

create or replace function public.perf_save_competency(target_id uuid,next_name text,next_meaning text,next_weight numeric,next_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid;
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if length(btrim(coalesce(next_name,''))) not between 2 and 160
    or length(btrim(coalesce(next_meaning,''))) not between 2 and 2000
    or next_weight is null or next_weight<=0 or next_weight>100 then
    raise exception 'Preencha nome, significado e peso entre 0 e 100' using errcode='22023'; end if;
  if target_id is null then
    insert into public.perf_competencies(name,meaning,max_weight,active)
      values(btrim(next_name),btrim(next_meaning),next_weight,coalesce(next_active,true)) returning id into result_id;
  else
    update public.perf_competencies set name=btrim(next_name),meaning=btrim(next_meaning),
      max_weight=next_weight,active=coalesce(next_active,true),updated_at=now()
      where id=target_id returning id into result_id;
    if result_id is null then raise exception 'Competência não encontrada' using errcode='P0002'; end if;
  end if;
  return result_id;
end;
$$;

create or replace function public.perf_save_model(target_id uuid,next_name text,next_audience text,next_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid;
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if length(btrim(coalesce(next_name,''))) not between 3 and 160 then
    raise exception 'Informe o nome do modelo' using errcode='22023'; end if;
  if target_id is null then
    insert into public.perf_models(name,audience,active)
      values(btrim(next_name),btrim(coalesce(next_audience,'')),coalesce(next_active,true)) returning id into result_id;
  else
    update public.perf_models set name=btrim(next_name),audience=btrim(coalesce(next_audience,'')),
      active=coalesce(next_active,true),updated_at=now() where id=target_id returning id into result_id;
    if result_id is null then raise exception 'Modelo não encontrado' using errcode='P0002'; end if;
  end if;
  return result_id;
end;
$$;

create or replace function public.perf_set_model_competencies(target_model uuid,competency_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if not exists(select 1 from public.perf_models m where m.id=target_model) then
    raise exception 'Modelo não encontrado' using errcode='P0002'; end if;
  if competency_ids is null or cardinality(competency_ids)>100 or
    array_position(competency_ids,null) is not null or
    (select count(distinct x.id) from unnest(competency_ids) as x(id))<>cardinality(competency_ids) or
    exists(select 1 from unnest(competency_ids) as x(id)
      where not exists(select 1 from public.perf_competencies c where c.id=x.id and c.active)) then
    raise exception 'Selecione competências ativas, sem repetição' using errcode='22023'; end if;
  delete from public.perf_model_competencies mc where mc.model_id=target_model;
  insert into public.perf_model_competencies(model_id,competency_id,display_order)
    select target_model,x.id,x.ord::integer from unnest(competency_ids) with ordinality as x(id,ord);
  update public.perf_models set updated_at=now() where id=target_model;
end;
$$;

create or replace function public.perf_save_assessment(
  target_id uuid,target_model uuid,target_employee_id bigint,next_evaluator text,
  next_date date,next_scores jsonb,finalize boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.perf_assessments%rowtype; m public.perf_models%rowtype;
  employee jsonb; score numeric; item record; score_item jsonb; total_weight numeric; result_id uuid;
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if next_scores is null or jsonb_typeof(next_scores)<>'object' then
    raise exception 'Avaliações inválidas' using errcode='22023'; end if;
  if target_id is null then
    select * into m from public.perf_models where id=target_model and active;
    if not found then raise exception 'Modelo não encontrado ou inativo' using errcode='P0002'; end if;
    select e.value into employee from public.app_state s,
      lateral jsonb_array_elements(s.employees) e(value)
      where s.id=1 and (e.value->>'id')::bigint=target_employee_id;
    if employee is null then raise exception 'Funcionário não encontrado' using errcode='P0002'; end if;
    if length(btrim(coalesce(next_evaluator,'')))<2 or next_date is null then
      raise exception 'Informe responsável e data' using errcode='22023'; end if;
    insert into public.perf_assessments(model_id,employee_id,employee_name,department,
      position_name,admission_date,model_name,evaluator,evaluation_date,created_by)
      values(m.id,target_employee_id,coalesce(employee->>'name',''),coalesce(employee->>'sector',''),
        coalesce(employee->>'role',''),nullif(employee->>'hire','')::date,m.name,btrim(next_evaluator),next_date,(select auth.uid()))
      returning id into result_id;
    insert into public.perf_assessment_items(assessment_id,competency_id,competency_name,meaning,weight,display_order)
      select result_id,c.id,c.name,c.meaning,c.max_weight,mc.display_order
      from public.perf_model_competencies mc join public.perf_competencies c on c.id=mc.competency_id
      where mc.model_id=m.id order by mc.display_order;
  else
    select * into a from public.perf_assessments where id=target_id for update;
    if not found then raise exception 'Avaliação não encontrada' using errcode='P0002'; end if;
    if a.status<>'draft' then raise exception 'Avaliação finalizada não pode ser alterada' using errcode='42501'; end if;
    if a.model_id is distinct from target_model or a.employee_id is distinct from target_employee_id then
      raise exception 'Modelo e colaborador não podem ser trocados no rascunho' using errcode='22023'; end if;
    if length(btrim(coalesce(next_evaluator,'')))<2 or next_date is null then
      raise exception 'Informe responsável e data' using errcode='22023'; end if;
    result_id:=target_id;
    update public.perf_assessments set evaluator=btrim(next_evaluator),evaluation_date=next_date,updated_at=now() where id=result_id;
  end if;
  for item in select * from public.perf_assessment_items where assessment_id=result_id loop
    score_item:=next_scores->(item.competency_id::text);
    score:=case when score_item is null or score_item='null'::jsonb or score_item='""'::jsonb then null
      when jsonb_typeof(score_item)='number' then (score_item #>> '{}')::numeric
      else null end;
    if score_item is not null and score_item<>'null'::jsonb and score_item<>'""'::jsonb
      and (score is null or score<0 or score>100) then
      raise exception 'A avaliação deve ficar entre 0 e 100' using errcode='22023'; end if;
    update public.perf_assessment_items set percentage=score,
      weighted_result=case when score is null then null else round(item.weight*score/100,2) end
      where id=item.id;
  end loop;
  if coalesce(finalize,false) then
    select coalesce(sum(weight),0) into total_weight from public.perf_assessment_items where assessment_id=result_id;
    if total_weight<>100 or not exists(select 1 from public.perf_assessment_items where assessment_id=result_id)
      or exists(select 1 from public.perf_assessment_items where assessment_id=result_id and percentage is null) then
      raise exception 'Para finalizar, os pesos devem somar 100%% e todas as avaliações devem estar preenchidas' using errcode='22023'; end if;
    update public.perf_assessments set status='finalized',
      final_result=(select round(sum(weighted_result),2) from public.perf_assessment_items where assessment_id=result_id),
      finalized_at=now(),updated_at=now() where id=result_id;
  end if;
  return result_id;
end;
$$;

revoke all on function public.perf_is_manager(),
  public.perf_save_competency(uuid,text,text,numeric,boolean),
  public.perf_save_model(uuid,text,text,boolean),
  public.perf_set_model_competencies(uuid,uuid[]),
  public.perf_save_assessment(uuid,uuid,bigint,text,date,jsonb,boolean) from public,anon;
grant execute on function public.perf_is_manager(),
  public.perf_save_competency(uuid,text,text,numeric,boolean),
  public.perf_save_model(uuid,text,text,boolean),
  public.perf_set_model_competencies(uuid,uuid[]),
  public.perf_save_assessment(uuid,uuid,bigint,text,date,jsonb,boolean) to authenticated;
commit;
