# SPFLY Admin — V9

A V9 mantém o módulo Capacitação e simplifica os perfis para **Administrador** e **Usuário**. O administrador escolhe, por pessoa, quais telas podem ser visualizadas e quais podem ser editadas. Início e Relatórios são apenas de consulta. Na Capacitação, a permissão de edição do usuário significa somente enviar o próprio certificado; trilhas, cursos, inscrições e conclusões ficam sob controle do administrador.

## Atualizar a V8 existente

1. Execute `supabase/migration-v9-access-certificates.sql` **uma vez** no SQL Editor do projeto Supabase. Ela preserva funcionários, treinamentos, trilhas e anexos. Contas RH passam a Usuário com visualização e edição de Funcionários/Treinamentos; contas Funcionário passam a Usuário com visualização de Capacitação e permissão de anexo. As conclusões anteriores de cursos que exigem certificado ficam pendentes de conferência.
2. Atualize a função `invite-admin` usando `supabase/functions/invite-admin/index.ts`. Mantenha o secret `SPFLY_INITIAL_PASSWORD` configurado.
3. Publique `index.html`, `auth.js`, `capacitation.js` e `capacitation.css` na raiz do GitHub Pages. `config.js`, `spfly_logo.png` e `.nojekyll` continuam necessários.

## Certificados

- O usuário precisa estar vinculado a um cadastro de funcionário e ter visualização e permissão de anexo na tela Capacitação.
- O portal aceita PDF/JPG/JPEG/PNG de até 10 MB e verifica o início do arquivo antes do envio. A conferência de conteúdo e correspondência com funcionário/curso é manual.
- O administrador abre o arquivo e então o aprova ou rejeita com motivo. Um certificado aprovado confirma a conclusão do curso e não pode ser substituído. Se rejeitado, o usuário vê o motivo e pode enviar um novo arquivo.
- A regra é aplicada no banco e no armazenamento privado. Ocultar botões na interface não é a única proteção.

## Instalação nova

Execute `supabase/schema.sql`, depois as migrações V6, V7, V8 e V9, nessa ordem. Configure a autenticação e a primeira conta administrativa conforme as instruções da V7. A V5 é necessária apenas quando se atualiza uma instalação anterior à V6.
