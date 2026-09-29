# SPFLY Admin — V20

## Ajuste da V20

O histórico de capacitações na ficha do funcionário mostra apenas trilhas e inscrições ainda ativas; registros excluídos ou removidos deixam de aparecer. No modo escuro, o destaque das linhas das tabelas mantém fundo e texto com contraste adequado. Não há migração de banco de dados nesta versão.

## Ajuste da V19

Em **Funcionários > Visualizar > Histórico de capacitações**, cada trilha aparece recolhida, mostrando apenas o nome. Clique no nome para expandir e ver o progresso, os cursos e os certificados. Não há alteração no banco de dados nesta versão.

## Ajuste da V18

Em **Funcionários > Visualizar**, a ficha mostra o histórico de capacitações: trilhas, cursos, progresso, situação e certificados. O administrador também consulta trilhas e inscrições removidas, preservadas como histórico. Usuários com acesso a Funcionários e Capacitação visualizam apenas o próprio histórico. Execute `supabase/migration-v18-employee-cap-history.sql` antes de publicar `index.html`, `capacitation.js` e `capacitation.css`.

## Ajuste da V17

Na tela do funcionário, **Iniciar** libera o link do curso. Após fazer o curso, **Concluir** registra o término. Cursos sem certificado obrigatório são concluídos nesse momento. Nos cursos com certificado obrigatório, **Concluir** libera **Anexar certificado**; o progresso só conta como concluído depois da aprovação administrativa do documento. Execute `supabase/migration-v17-course-flow.sql` depois da migração V16 e antes de publicar `index.html` e `capacitation.js`.

## Ajuste da V16

Administradores podem usar **Excluir Trilha** na tela da trilha ou **Remover da trilha** na lista de funcionários inscritos. A remoção de um funcionário o retira de todos os cursos da trilha. Trilhas e inscrições removidas deixam de aparecer no portal; o histórico de progresso e os certificados continuam guardados. Se o funcionário for inscrito novamente, o histórico anterior reaparece. Execute `supabase/migration-v16-track-removal.sql` no SQL Editor do Supabase antes de publicar `index.html` e `capacitation.js` desta versão.

## Ajuste da V15

Na aba **Capacitação > Funcionários > Ver evolução**, o administrador vê o motivo de cada certificado recusado e pode usar **Editar motivo** para corrigi-lo. A mudança aparece para o funcionário após a atualização da tela. Execute `supabase/migration-v15-rejection-reason.sql` no SQL Editor do Supabase antes de publicar `index.html`, `capacitation.js` e `capacitation.css` desta versão.

## Ajuste da V14

O ícone da SPFLY enviado para esta versão aparece na aba do navegador por meio de `favicon.png`. Publique `index.html` e `favicon.png` juntos na raiz do repositório GitHub Pages. Não há alteração no banco de dados.

A V10 organiza a tela de acessos como lista compacta. Cada linha mostra nome, e-mail, perfil, telas liberadas e status. Há busca por nome, e-mail ou tela e filtro por perfil. O administrador abre "Editar acesso" apenas para a pessoa desejada; as permissões e regras da V9 permanecem as mesmas.

Administradores também podem excluir um treinamento pela tela de detalhes. O registro deixa de aparecer no calendário e nos relatórios, mas pode ser recuperado em **Treinamentos > Ver excluídos**. A exclusão preserva participantes e anexos para restauração. Usuários comuns não recebem a ação de excluir ou restaurar.

## Ajustes da V11

- O botão de remoção de anexos do treinamento é um X vermelho compacto, com nome acessível e confirmação antes da remoção.
- É possível editar um funcionário existente em **Funcionários > Editar**. A matrícula, o documento, o nome, o setor, o cargo, as datas, o contato e o status são atualizados no mesmo registro.
- O menu Cadastros saiu da navegação. A gestão de setores fica em **Funcionários > Gerenciar setores**. Setores existentes podem ser renomeados para todos os funcionários vinculados. Para criar um setor, escolha **Novo setor** e salve um funcionário com ele; o setor passa a constar dos dados compartilhados.
- A navegação principal segue Início, Treinamentos, Capacitação, Funcionários e Relatórios; Acessos continua disponível para administradores.
- Certificados da Capacitação mostram **Pendente**, **Certificado anexado** e **Concluído** conforme o fluxo de conferência administrativa. A lista de inscritos resume esses estados por funcionário.

## Avaliação de eficácia da V12

Ao cadastrar um treinamento, informe o período de revisão em dias após a data do treinamento e o método de avaliação (por exemplo, observação prática, prova, entrevista ou indicadores). A tela de detalhes calcula a data prevista. Treinamentos antigos continuam disponíveis; preencha o planejamento na tela de detalhes. Se o registro estiver concluído e bloqueado, use **Alterar registro** antes de ajustar o planejamento.

Após concluir o treinamento, uma pessoa com permissão de edição em Treinamentos pode registrar o resultado **Eficaz** ou **Não eficaz**, a data e uma evidência escrita. A avaliação não altera o status de conclusão do treinamento. Cada avaliação fica no histórico, e a lista de treinamentos mostra quando a revisão está programada, vencida ou avaliada.

## Ajuste da V13

O nome e o perfil exibidos no topo e na barra lateral são somente informativos. Clicar neles não abre mais a tela de alteração do nome. O nome definido no cadastro do acesso continua aparecendo após o login. A etapa de nome permanece apenas como proteção para contas antigas que não tenham nome cadastrado.

## Atualização da V12

Publique `index.html`, `auth.js` e este `README.md` na raiz do repositório GitHub Pages. Não há migração de banco nem alteração na Edge Function para esta versão. Mantenha os demais arquivos da V12.

## Instalação nova

Use as instruções da V9 para configurar Supabase, autenticação, banco e função de cadastro. Depois publique os arquivos desta versão.
