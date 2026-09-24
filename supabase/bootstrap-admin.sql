-- Depois de convidar o primeiro usuário em Authentication > Users, substitua
-- o endereço abaixo e execute este comando no SQL Editor.
-- Não coloque este arquivo com o e-mail preenchido em um repositório público.

insert into public.admin_users (id, email, active)
select id, email, true
from auth.users
where lower(email) = lower('SEU_EMAIL_AQUI')
on conflict (id) do update set active = true, email = excluded.email;
