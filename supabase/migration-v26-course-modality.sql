-- V26: modalidade de trilhas e cursos. Registros antigos permanecem sem
-- modalidade até serem editados; não inferimos uma modalidade inexistente.
begin;

alter table public.cap_tracks
  add column if not exists modality text;
alter table public.cap_courses
  add column if not exists modality text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='cap_tracks_modality_v26_check') then
    alter table public.cap_tracks add constraint cap_tracks_modality_v26_check
      check (modality is null or modality in ('Online','Presencial','Híbrido'));
  end if;
  if not exists (select 1 from pg_constraint where conname='cap_courses_modality_v26_check') then
    alter table public.cap_courses add constraint cap_courses_modality_v26_check
      check (modality is null or modality in ('Online','Presencial','Híbrido'));
  end if;
end $$;

-- A exigência vale para cadastros novos; registros antigos sem modalidade
-- continuam válidos e podem receber a informação quando forem editados.
create or replace function public.cap_require_new_modality_v26()
returns trigger language plpgsql as $$
begin
  if new.modality is null then
    raise exception 'Selecione a modalidade antes de cadastrar.';
  end if;
  return new;
end $$;
drop trigger if exists cap_tracks_new_modality_v26 on public.cap_tracks;
create trigger cap_tracks_new_modality_v26 before insert on public.cap_tracks
  for each row execute function public.cap_require_new_modality_v26();
drop trigger if exists cap_courses_new_modality_v26 on public.cap_courses;
create trigger cap_courses_new_modality_v26 before insert on public.cap_courses
  for each row execute function public.cap_require_new_modality_v26();

grant update(modality) on public.cap_tracks to authenticated;
grant update(modality) on public.cap_courses to authenticated;

commit;
