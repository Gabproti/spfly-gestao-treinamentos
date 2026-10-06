-- V33: menu Formulários, pesos de 0 a 100 e importação atômica de competências.
begin;

alter table public.perf_competencies
  drop constraint if exists perf_competencies_max_weight_check;
alter table public.perf_competencies
  add constraint perf_competencies_max_weight_check check (max_weight >= 0 and max_weight <= 100);
alter table public.perf_assessment_items
  drop constraint if exists perf_assessment_items_weight_check;
alter table public.perf_assessment_items
  add constraint perf_assessment_items_weight_check check (weight >= 0 and weight <= 100);

create or replace function public.perf_save_competency(
  target_id uuid,next_name text,next_meaning text,next_weight numeric,next_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid; clean_name text := btrim(coalesce(next_name,''));
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if length(clean_name) not between 2 and 160
    or length(btrim(coalesce(next_meaning,''))) not between 2 and 2000
    or next_weight is null or next_weight < 0 or next_weight > 100
    or round(next_weight,2) <> next_weight then
    raise exception 'Preencha nome, significado e peso entre 0 e 100 com até duas casas decimais' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(65342,1);
  if exists(select 1 from public.perf_competencies c
    where lower(btrim(c.name))=lower(clean_name) and c.id is distinct from target_id) then
    raise exception 'Competência com este nome já cadastrada' using errcode='23505';
  end if;
  if target_id is null then
    insert into public.perf_competencies(name,meaning,max_weight,active)
      values(clean_name,btrim(next_meaning),next_weight,coalesce(next_active,true)) returning id into result_id;
  else
    update public.perf_competencies set name=clean_name,meaning=btrim(next_meaning),
      max_weight=next_weight,active=coalesce(next_active,true),updated_at=now()
      where id=target_id returning id into result_id;
    if result_id is null then raise exception 'Competência não encontrada' using errcode='P0002'; end if;
  end if;
  return result_id;
end;
$$;

create or replace function public.perf_import_competencies(next_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare item jsonb; clean_name text; clean_meaning text; next_weight numeric;
  seen_names text[] := array[]::text[]; total integer := 0;
begin
  if not public.perf_is_manager() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if next_rows is null or jsonb_typeof(next_rows)<>'array'
    or jsonb_array_length(next_rows) not between 1 and 500 then
    raise exception 'Envie de 1 a 500 competências' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(65342,1);
  for item in select value from jsonb_array_elements(next_rows) as x(value) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'weight')<>'number' then
      raise exception 'Linha %: peso inválido',total+2 using errcode='22023';
    end if;
    clean_name := btrim(coalesce(item->>'name',''));
    clean_meaning := btrim(coalesce(item->>'meaning',''));
    next_weight := (item->>'weight')::numeric;
    if length(clean_name) not between 2 and 160 or length(clean_meaning) not between 2 and 2000
      or next_weight<0 or next_weight>100 or round(next_weight,2)<>next_weight then
      raise exception 'Linha %: nome, significado ou peso inválido',total+2 using errcode='22023';
    end if;
    if lower(clean_name)=any(seen_names) or exists(
      select 1 from public.perf_competencies c where lower(btrim(c.name))=lower(clean_name)) then
      raise exception 'Linha %: competência duplicada',total+2 using errcode='23505';
    end if;
    seen_names:=array_append(seen_names,lower(clean_name));
    insert into public.perf_competencies(name,meaning,max_weight,active)
      values(clean_name,clean_meaning,next_weight,true);
    total:=total+1;
  end loop;
  return total;
end;
$$;

revoke all on function public.perf_import_competencies(jsonb) from public,anon;
grant execute on function public.perf_import_competencies(jsonb) to authenticated;

commit;
