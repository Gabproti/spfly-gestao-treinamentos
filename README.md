# SPFLY | Gestão de Treinamentos — V7

Esta versão mantém o GitHub Pages para a interface e usa Supabase para login, dados compartilhados e anexos privados.

Para atualizar a instalação existente da V6, execute `supabase/migration-v7-direct-users.sql` uma vez no SQL Editor, configure a senha inicial na função `invite-admin`, atualize a função e publique os novos `index.html` e `auth.js`. Funcionários, treinamentos e anexos permanecem no banco.

**Site:** https://gabproti.github.io/spfly-gestao-treinamentos/

## Instalação

1. Para uma instalação nova, execute `supabase/schema.sql`, `supabase/migration-v6-access.sql` e `supabase/migration-v7-direct-users.sql`, nessa ordem. Para a instalação existente já atualizada à V6, execute apenas a V7.
2. Em Authentication > URL Configuration, defina Site URL e Redirect URL como `https://gabproti.github.io/spfly-gestao-treinamentos/`.
3. Em Authentication > Sign In / Providers, desative **Allow new users to sign up**. O acesso aos dados também é bloqueado por RLS para qualquer conta fora de `admin_users`.
4. Em Authentication > Users, crie a primeira conta administrativa ou use o fluxo de convite inicial já configurado. O cadastro de usuários dentro do portal começa após o primeiro administrador ter acesso.
5. No SQL Editor, execute `supabase/bootstrap-admin.sql` depois de substituir `SEU_EMAIL_AQUI` pelo e-mail do convidado. Confirme que uma linha foi adicionada.
6. Em Edge Functions > Secrets, defina `SPFLY_INITIAL_PASSWORD` com a senha inicial padrão. Publique `supabase/functions/invite-admin/index.ts` como função `invite-admin` (nome legado). Deixe **Verify JWT with legacy secret** desativado: a função usa `withSupabase({ auth: 'user' })` para validar a sessão do usuário antes de aceitar pedidos. A senha inicial não deve ser colocada no código público.
7. Envie `index.html`, `auth.js`, `config.js`, `spfly_logo.png` e `.nojekyll` para a raiz do repositório GitHub Pages.
8. Na página **Acessos**, o administrador cria contas com nome, e-mail e perfil, sem enviar convite. A senha inicial é exibida após o cadastro. O usuário entra e deve definir outra senha antes de acessar os dados.

## Segurança e dados

- `config.js` contém apenas a chave **publishable**. Nunca coloque uma `secret key`, `service_role` ou senha de banco no repositório ou no navegador.
- O banco só libera dados para contas ativas. O administrador acessa todas as telas. RH acessa Funcionários e Treinamentos. O usuário acessa apenas as telas marcadas pelo administrador. Anexos ficam em armazenamento privado.
- Cada gravação usa uma versão para detectar alterações simultâneas. Se outro administrador alterou os dados primeiro, a tela recarrega os dados do servidor em vez de sobrescrevê-los.
- Esta versão começa com o banco vazio. Os dados de demonstração da versão anterior não são importados. O armazenamento local do navegador anterior não é apagado.
- Os anexos novos ficam em um bucket privado. O limite é de 10 MB por arquivo.
- As contas criadas no portal ficam bloqueadas para leitura e edição dos dados até a troca da senha inicial. A senha padrão é compartilhada entre contas novas; entregue cada acesso somente à pessoa cadastrada e altere a senha padrão no Supabase quando necessário.

## Arquivos do projeto

- `index.html`: interface, login e gestão de acessos.
- `auth.js`: autenticação e conexão com banco/arquivos.
- `config.js`: URL e chave pública do projeto.
- `supabase/schema.sql`: tabelas, políticas e bucket privado.
- `supabase/bootstrap-admin.sql`: autorização inicial de uma conta.
- `supabase/migration-v5-admin-name.sql`: atualização da instalação existente para cadastro do nome.
- `supabase/migration-v6-access.sql`: perfis, permissões por tela e regras de gravação.
- `supabase/migration-v7-direct-users.sql`: bloqueio dos dados até a troca de senha.
- `supabase/functions/invite-admin/index.ts`: criação de usuários e troca obrigatória da senha inicial.
