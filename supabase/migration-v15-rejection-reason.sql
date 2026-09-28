-- V15: permite ao administrador corrigir o motivo de um certificado recusado.
create or replace function public.cap_update_rejection_reason(target_progress uuid,new_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cleaned_reason text := btrim(new_reason);
begin
  if not public.cap_is_manager() then
    raise exception 'Acesso negado' using errcode='42501';
  end if;
  if cleaned_reason is null or char_length(cleaned_reason) not between 3 and 1000 then
    raise exception 'Informe um motivo de 3 a 1000 caracteres' using errcode='22023';
  end if;
  update public.cap_progress
    set rejection_reason=cleaned_reason
    where id=target_progress and certificate_path is not null and validation_status='rejected';
  if not found then
    raise exception 'Certificado recusado não encontrado' using errcode='P0002';
  end if;
end;
$$;

revoke all on function public.cap_update_rejection_reason(uuid,text) from public,anon;
grant execute on function public.cap_update_rejection_reason(uuid,text) to authenticated;
