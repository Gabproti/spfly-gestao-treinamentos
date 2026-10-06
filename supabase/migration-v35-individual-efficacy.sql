-- V35: avaliação de eficácia individual por participante. Aplicar após a V34.
begin;

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
