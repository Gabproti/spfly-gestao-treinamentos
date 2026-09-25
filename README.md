# SPFLY Admin — V8

A V8 integra o módulo **Capacitação** à plataforma existente. Trilhas, cursos, inscrições, conclusões e certificados são compartilhados pelo Supabase. O GitHub Pages continua hospedando a interface. Os cursos abrem por links externos; somente certificados são enviados ao armazenamento privado.

## Atualizar a V7 existente

1. No SQL Editor do projeto Supabase, execute `supabase/migration-v8-capacitacao.sql` **uma vez**. Ela cria as tabelas, políticas de acesso e o bucket privado `cap-certificates`; não apaga funcionários, treinamentos nem anexos anteriores.
2. Atualize a Edge Function `invite-admin` com `supabase/functions/invite-admin/index.ts`. Mantenha o secret `SPFLY_INITIAL_PASSWORD` já configurado. A função permite criar conta com perfil **Funcionário**, vinculada ao cadastro da pessoa. A primeira senha segue o fluxo obrigatório de troca da V7.
3. Envie `index.html`, `auth.js`, `capacitation.js`, `capacitation.css`, `config.js`, `spfly_logo.png` e `.nojekyll` para a raiz do repositório GitHub Pages. A URL permanece `https://gabproti.github.io/spfly-gestao-treinamentos/`.

Para instalação nova, execute `supabase/schema.sql`, depois as migrações V6, V7 e V8 nessa ordem. A V5 é necessária apenas ao atualizar uma instalação anterior à V6. Consulte as instruções de bootstrap da V7 para criar a primeira conta administrativa.

## Uso

- **Administrador/RH:** criar e editar trilhas; adicionar cursos por URL; inscrever funcionários; consultar progresso individual, atrasos e certificados. Cursos e trilhas podem ser inativados ou encerrados sem excluir o histórico.
- **Funcionário:** entra com conta própria ligada ao seu cadastro, vê apenas suas inscrições, abre links em nova aba, marca manualmente a conclusão e anexa PDF/JPG/JPEG/PNG de até 10 MB quando o certificado for obrigatório. A troca da senha inicial continua obrigatória.
- A data limite é definida na inscrição com base na data inicial e na duração da trilha. Ao editar a duração ou data da trilha, inscrições anteriores mantêm seu prazo original para preservar o histórico. Novas inscrições usam as datas atualizadas.
- O progresso considera cursos **ativos**; cursos concluídos e depois inativados continuam visíveis no histórico individual.

## Segurança

- As tabelas têm RLS. RH e administradores consultam todas as trilhas e inscrições; funcionário consulta somente trilhas atribuídas a ele e seu próprio progresso.
- Certificados ficam no bucket privado `cap-certificates`. A visualização usa URL assinada de curta duração; o envio exige conclusão prévia do curso e vínculo com a inscrição.
- `config.js` contém apenas a chave pública do projeto. Nunca coloque `service_role`, secret key ou senha inicial no repositório.

## Arquivos

- `index.html`: interface e navegação existentes, acrescidas de Capacitação.
- `capacitation.js` e `capacitation.css`: lógica e visual do módulo, incluindo modo escuro e layout responsivo.
- `auth.js`: autenticação e criação de contas, com vinculação ao funcionário.
- `supabase/migration-v8-capacitacao.sql`: estrutura e regras do banco.
- `supabase/functions/invite-admin/index.ts`: função de criação de usuários e troca obrigatória da senha inicial.
