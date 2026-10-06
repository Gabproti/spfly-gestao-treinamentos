-- SPFLY V36: aplicar V34 e V35 juntas, em uma única transação.
-- Se qualquer instrução falhar, nenhuma das duas migrações será confirmada.
begin;

-- ===== V34: pesos por modelo =====
-- V34: pesos independentes por modelo. Aplicar depois da V33.
alter table public.perf_model_competencies add column if not exists weight numeric(5,2);
update public.perf_model_competencies mc set weight=c.max_weight
  from public.perf_competencies c where c.id=mc.competency_id and mc.weight is null;
alter table public.perf_model_competencies alter column weight set not null;
alter table public.perf_model_competencies drop constraint if exists perf_model_competencies_weight_check;
alter table public.perf_model_competencies add constraint perf_model_competencies_weight_check check(weight between 0 and 100);

-- O resultado pode exceder 100 quando a soma dos pesos exceder 100.
alter table public.perf_assessments alter column final_result type numeric(7,2);
alter table public.perf_assessments drop constraint if exists perf_assessments_check;
alter table public.perf_assessments add constraint perf_assessments_check check (
  (status='draft' and finalized_at is null) or
  (status='finalized' and finalized_at is not null and final_result between 0 and 10000));

-- A coluna antiga deixa de existir depois de transferir seus valores aos modelos.
drop function if exists public.perf_save_competency(uuid,text,text,numeric,boolean);
drop function if exists public.perf_import_competencies(jsonb);
drop function if exists public.perf_set_model_competencies(uuid,uuid[]);
alter table public.perf_competencies drop column max_weight;

create function public.perf_save_competency_v34(
  target_id uuid,next_name text,next_meaning text,next_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid; clean_name text := btrim(coalesce(next_name,''));
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if length(clean_name) not between 2 and 160 or length(btrim(coalesce(next_meaning,''))) not between 2 and 2000 then
    raise exception 'Informe nome e significado válidos' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(65342,1);
  if exists(select 1 from public.perf_competencies c where lower(btrim(c.name))=lower(clean_name)
    and (target_id is null or c.id<>target_id)) then
    raise exception 'Competência duplicada' using errcode='23505'; end if;
  if target_id is null then
    insert into public.perf_competencies(name,meaning,active)
      values(clean_name,btrim(next_meaning),coalesce(next_active,true)) returning id into result_id;
  else
    update public.perf_competencies set name=clean_name,meaning=btrim(next_meaning),
      active=coalesce(next_active,true),updated_at=now()
      where id=target_id returning id into result_id;
    if result_id is null then raise exception 'Competência não encontrada' using errcode='P0002'; end if;
  end if;
  return result_id;
end;
$$;

create function public.perf_import_competencies_v34(next_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare item jsonb; clean_name text; clean_meaning text; count_rows integer := 0;
  seen_names text[] := array[]::text[];
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if next_rows is null or jsonb_typeof(next_rows)<>'array' or jsonb_array_length(next_rows) not between 1 and 500 then
    raise exception 'Envie de 1 a 500 competências' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(65342,1);
  for item in select value from jsonb_array_elements(next_rows) loop
    clean_name:=btrim(coalesce(item->>'name',''));
    clean_meaning:=btrim(coalesce(item->>'meaning',''));
    if jsonb_typeof(item)<>'object' or length(clean_name) not between 2 and 160
      or length(clean_meaning) not between 2 and 2000 then
      raise exception 'Dados de competência inválidos' using errcode='22023'; end if;
    if lower(clean_name)=any(seen_names) or exists(
      select 1 from public.perf_competencies c where lower(btrim(c.name))=lower(clean_name)) then
      raise exception 'Competência duplicada: %',clean_name using errcode='23505'; end if;
    seen_names:=array_append(seen_names,lower(clean_name));
    insert into public.perf_competencies(name,meaning,active) values(clean_name,clean_meaning,true);
    count_rows:=count_rows+1;
  end loop;
  return count_rows;
end;
$$;

create function public.perf_set_model_competencies_v34(target_model uuid,next_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; competency uuid; item_weight numeric; item_order integer := 0;
  seen_ids uuid[] := array[]::uuid[];
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if not exists(select 1 from public.perf_models m where m.id=target_model) then
    raise exception 'Modelo não encontrado' using errcode='P0002'; end if;
  if next_items is null or jsonb_typeof(next_items)<>'array' or jsonb_array_length(next_items)>100 then
    raise exception 'Informe até 100 competências' using errcode='22023'; end if;
  -- Validar todos os itens antes de modificar os vínculos.
  for item in select value from jsonb_array_elements(next_items) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'weight')<>'number' then
      raise exception 'Informe o peso de cada competência' using errcode='22023'; end if;
    begin competency:=(item->>'competency_id')::uuid; item_weight:=(item->>'weight')::numeric;
    exception when invalid_text_representation then
      raise exception 'Competência ou peso inválido' using errcode='22023'; end;
    if competency is null or competency=any(seen_ids) or item_weight is null or
      item_weight<0 or item_weight>100 or round(item_weight,2)<>item_weight or
      not exists(select 1 from public.perf_competencies c where c.id=competency and c.active) then
      raise exception 'Selecione competências ativas, sem repetição, com pesos de 0%% a 100%%' using errcode='22023'; end if;
    seen_ids:=array_append(seen_ids,competency);
  end loop;
  delete from public.perf_model_competencies mc where mc.model_id=target_model;
  for item in select value from jsonb_array_elements(next_items) loop
    item_order:=item_order+1;
    insert into public.perf_model_competencies(model_id,competency_id,weight,display_order)
      values(target_model,(item->>'competency_id')::uuid,(item->>'weight')::numeric,item_order);
  end loop;
  update public.perf_models set updated_at=now() where id=target_model;
end;
$$;

revoke all on function public.perf_save_competency_v34(uuid,text,text,boolean),
  public.perf_import_competencies_v34(jsonb),
  public.perf_set_model_competencies_v34(uuid,jsonb) from public,anon;
grant execute on function public.perf_save_competency_v34(uuid,text,text,boolean),
  public.perf_import_competencies_v34(jsonb),
  public.perf_set_model_competencies_v34(uuid,jsonb) to authenticated;

-- As funções de avaliações são redefinidas abaixo para usar o peso do vínculo
-- e para não exigir total de 100%.

create or replace function public.perf_save_assessment(
  target_id uuid,target_model uuid,target_employee_id bigint,next_evaluator text,
  next_date date,next_scores jsonb,finalize boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.perf_assessments%rowtype; m public.perf_models%rowtype;
  employee jsonb; score numeric; item record; score_item jsonb; result_id uuid;
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
      select result_id,c.id,c.name,c.meaning,mc.weight,mc.display_order
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
    if not exists(select 1 from public.perf_assessment_items where assessment_id=result_id)
      or exists(select 1 from public.perf_assessment_items where assessment_id=result_id and percentage is null) then
      raise exception 'Preencha todas as avaliações para finalizar' using errcode='22023'; end if;
    update public.perf_assessments set status='finalized',
      final_result=(select round(sum(weighted_result),2) from public.perf_assessment_items where assessment_id=result_id),
      finalized_at=now(),updated_at=now() where id=result_id;
  end if;
  return result_id;
end;
$$;

create or replace function public.perf_update_assessment(
  target_id uuid,next_employee_name text,next_department text,next_position text,
  next_admission_date date,next_evaluator text,next_date date,next_scores jsonb,next_finalize boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare assessment public.perf_assessments%rowtype; item record; score_item jsonb;
  score numeric;
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

-- ===== V35: eficácia individual =====
-- V35: avaliação de eficácia individual por participante. Aplicar após a V34.
create table if not exists public.training_efficacy_reviews (
  id uuid primary key default gen_random_uuid(),
  training_id bigint not null,
  employee_id bigint not null,
  model_id uuid references public.perf_models(id) on delete set null,
  model_name text not null,
  reviewed_on date not null,
  result text not null check (result in ('Eficaz','Não eficaz')),
  score numeric(5,2) not null check (score between 0 and 100),
  notes text not null check (length(btrim(notes)) between 3 and 2000),
  evaluator text not null check (length(btrim(evaluator)) between 2 and 160),
  created_by uuid not null references auth.users(id),
  last_edited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id)
);
create unique index if not exists training_efficacy_one_active_per_participant
  on public.training_efficacy_reviews(training_id,employee_id) where deleted_at is null;
create index if not exists training_efficacy_employee_history
  on public.training_efficacy_reviews(employee_id,reviewed_on desc) where deleted_at is null;

alter table public.training_efficacy_reviews enable row level security;
revoke all on public.training_efficacy_reviews from anon,authenticated;
grant select on public.training_efficacy_reviews to authenticated;
drop policy if exists training_efficacy_read on public.training_efficacy_reviews;
create policy training_efficacy_read on public.training_efficacy_reviews for select to authenticated
  using (deleted_at is null and public.perf_can_view());

create or replace function public.training_efficacy_save(
  target_id uuid,target_training_id bigint,target_employee_id bigint,target_model_id uuid,
  next_reviewed_on date,next_result text,next_score numeric,next_notes text,next_evaluator text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare training jsonb; employee jsonb; model public.perf_models%rowtype;
  result_id uuid; old_review public.training_efficacy_reviews%rowtype; training_date date;
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  select t.value into training from public.app_state s,
    lateral jsonb_array_elements(s.trainings) as t(value)
    where s.id=1 and (t.value->>'id')::bigint=target_training_id and t.value->>'deletedAt' is null
    for update of s;
  if training is null or training->>'status'<>'Ministrado' then
    raise exception 'Treinamento não encontrado ou ainda não concluído' using errcode='22023'; end if;
  if not (coalesce(training->'participants','[]'::jsonb) @> jsonb_build_array(target_employee_id)) then
    raise exception 'Funcionário não consta na lista de participantes' using errcode='22023'; end if;
  select e.value into employee from public.app_state s,
    lateral jsonb_array_elements(s.employees) as e(value)
    where s.id=1 and (e.value->>'id')::bigint=target_employee_id;
  if employee is null then raise exception 'Funcionário não encontrado' using errcode='P0002'; end if;
  select * into model from public.perf_models where id=target_model_id;
  if not found or (target_id is null and not model.active) then
    raise exception 'Modelo de avaliação não encontrado ou inativo' using errcode='22023'; end if;
  if next_reviewed_on is null or next_reviewed_on>current_date or
    next_result is null or next_result not in ('Eficaz','Não eficaz') or next_score is null or
    next_score<0 or next_score>100 or round(next_score,2)<>next_score or
    length(btrim(coalesce(next_notes,''))) not between 3 and 2000 or
    length(btrim(coalesce(next_evaluator,''))) not between 2 and 160 then
    raise exception 'Preencha data, resultado, nota, evidência e responsável válidos' using errcode='22023'; end if;
  if training->>'date' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then
    training_date:=to_date(training->>'date','DD/MM/YYYY');
    if next_reviewed_on<training_date then
      raise exception 'A avaliação não pode ser anterior ao treinamento' using errcode='22023'; end if;
  end if;
  if target_id is null then
    if exists(select 1 from public.training_efficacy_reviews r
      where r.training_id=target_training_id and r.employee_id=target_employee_id and r.deleted_at is null) then
      raise exception 'Este participante já possui avaliação neste treinamento' using errcode='23505'; end if;
    insert into public.training_efficacy_reviews(training_id,employee_id,model_id,model_name,
      reviewed_on,result,score,notes,evaluator,created_by)
      values(target_training_id,target_employee_id,target_model_id,model.name,
        next_reviewed_on,next_result,next_score,btrim(next_notes),btrim(next_evaluator),(select auth.uid()))
      returning id into result_id;
  else
    select * into old_review from public.training_efficacy_reviews r
      where r.id=target_id and r.deleted_at is null for update;
    if not found or old_review.training_id<>target_training_id or old_review.employee_id<>target_employee_id then
      raise exception 'Avaliação não encontrada para este participante' using errcode='P0002'; end if;
    update public.training_efficacy_reviews set model_id=target_model_id,model_name=model.name,
      reviewed_on=next_reviewed_on,result=next_result,score=next_score,
      notes=btrim(next_notes),evaluator=btrim(next_evaluator),
      last_edited_by=(select auth.uid()),updated_at=now()
      where id=target_id returning id into result_id;
  end if;
  return result_id;
end;
$$;

create or replace function public.training_efficacy_delete(target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  update public.training_efficacy_reviews set deleted_at=now(),deleted_by=(select auth.uid()),updated_at=now()
    where id=target_id and deleted_at is null;
  if not found then raise exception 'Avaliação não encontrada' using errcode='P0002'; end if;
end;
$$;

-- Uma remoção da lista de participantes invalida automaticamente a avaliação,
-- inclusive quando a alteração vier de outra tela ou sessão.
create or replace function public.training_efficacy_sync_participants()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.training_efficacy_reviews r set deleted_at=now(),updated_at=now()
  where r.deleted_at is null and not exists (
    select 1 from jsonb_array_elements(new.trainings) as t(value)
    where (t.value->>'id')::bigint=r.training_id
      and t.value->>'deletedAt' is null
      and t.value->>'status'='Ministrado'
      and coalesce(t.value->'participants','[]'::jsonb) @> jsonb_build_array(r.employee_id));
  return new;
end;
$$;
drop trigger if exists training_efficacy_participants_sync on public.app_state;
create trigger training_efficacy_participants_sync after update of trainings on public.app_state
  for each row when (old.trainings is distinct from new.trainings)
  execute function public.training_efficacy_sync_participants();

revoke all on function public.training_efficacy_save(uuid,bigint,bigint,uuid,date,text,numeric,text,text),
  public.training_efficacy_delete(uuid) from public,anon;
grant execute on function public.training_efficacy_save(uuid,bigint,bigint,uuid,date,text,numeric,text,text),
  public.training_efficacy_delete(uuid) to authenticated;

commit;
