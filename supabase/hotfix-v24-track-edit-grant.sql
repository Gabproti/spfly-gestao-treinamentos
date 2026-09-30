-- Complemento para projetos que aplicaram a primeira edição da migração V24.
-- A política cap_tracks_update continua permitindo alterações somente a administradores.
grant update(sequence_name,sequence_order,certificate_mode) on public.cap_tracks to authenticated;
