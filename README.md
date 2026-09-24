# SPFLY | Gestão de Treinamentos — V6

Esta versão mantém o GitHub Pages para a interface e usa Supabase para login, dados compartilhados e anexos privados.

Para atualizar a instalação existente, execute `supabase/migration-v6-access.sql` uma vez no SQL Editor, atualize a função `invite-admin` e publique os novos `index.html` e `auth.js`. Funcionários, treinamentos e anexos permanecem no banco.

**Site:** https://gabproti.github.io/spfly-gestao-treinamentos/

## Instalação

1. Para uma instalação nova, execute `supabase/schema.sql` e depois `supabase/migration-v6-access.sql`. Para a instalação existente já atualizada à V5, execute apenas a V6.
2. Em Authentication > URL Configuration, defina Site URL e Redirect URL como `https://gabproti.github.io/spfly-gestao-treinamentos/`.
3. Em Authentication > Sign In / Providers, desative **Allow new users to sign up**. O acesso aos dados também é bloqueado por RLS para qualquer conta fora de `admin_users`.
4. Em Authentication > Users, envie um convite para o primeiro administrador.
5. No SQL Editor, execute `supabase/bootstrap-admin.sql` depois de substituir `SEU_EMAIL_AQUI` pelo e-mail do convidado. Confirme que uma linha foi adicionada.
6. Em Edge Functions, publique `supabase/functions/invite-admin/index.ts` como função `invite-admin`. Deixe **Verify JWT with legacy secret** desativado: a função usa `withSupabase({ auth: 'user' })` para validar a sessão do usuário antes de aceitar pedidos.
7. Envie `index.html`, `auth.js`, `config.js`, `spfly_logo.png` e `.nojekyll` para a raiz do repositório GitHub Pages.
8. O primeiro administrador abre o e-mail de convite, define a senha no site e entra. No primeiro acesso, informa o próprio nome. Na página **Acessos**, pode convidar administradores, RH e usuários.

## Segurança e dados

- `config.js` contém apenas a chave **publishable**. Nunca coloque uma `secret key`, `service_role` ou senha de banco no repositório ou no navegador.
- O banco só libera dados para contas ativas. O administrador acessa todas as telas. RH acessa Funcionários e Treinamentos. O usuário acessa apenas as telas marcadas pelo administrador. Anexos ficam em armazenamento privado.
- Cada gravação usa uma versão para detectar alterações simultâneas. Se outro administrador alterou os dados primeiro, a tela recarrega os dados do servidor em vez de sobrescrevê-los.
- Esta versão começa com o banco vazio. Os dados de demonstração da versão anterior não são importados. O armazenamento local do navegador anterior não é apagado.
- Os anexos novos ficam em um bucket privado. O limite é de 10 MB por arquivo.

## Arquivos do projeto

- `index.html`: interface, login e gestão de acessos.
- `auth.js`: autenticação e conexão com banco/arquivos.
- `config.js`: URL e chave pública do projeto.
- `supabase/schema.sql`: tabelas, políticas e bucket privado.
- `supabase/bootstrap-admin.sql`: autorização inicial de uma conta.
- `supabase/migration-v5-admin-name.sql`: atualização da instalação existente para cadastro do nome.
- `supabase/migration-v6-access.sql`: perfis, permissões por tela e regras de gravação.
- `supabase/functions/invite-admin/index.ts`: convite feito por um administrador autenticado.
