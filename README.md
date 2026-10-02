# SPFLY Admin — V26

## Ajuste da V26

Em **Capacitação**, novas trilhas e cursos exigem a modalidade **Online**, **Presencial** ou **Híbrido**. A modalidade aparece nos cartões e detalhes. Registros anteriores continuam sem valor atribuído e aparecem como **Não informada** até serem editados. Execute `supabase/migration-v26-course-modality.sql` antes de publicar os arquivos desta versão; ela acrescenta os campos sem alterar os dados existentes e exige modalidade somente em novos cadastros.

Em **Relatórios > Carga Horária dos Cursos**, consulte a carga prevista e as horas realizadas por funcionário e por curso, além do detalhamento de capacitações e treinamentos. Horas realizadas contam apenas cursos concluídos e treinamentos ministrados com funcionário vinculado. Os filtros incluem busca, funcionário, modalidade, situação e período de conclusão. **Exportar CSV para Excel** inclui os dois totais consolidados e o detalhamento.

Certificados em PDF da Capacitação e certificados e anexos gerais da ficha de Funcionários abrem dentro do portal, com nome do arquivo, opção **Visualizar PDF**, abertura em nova aba e download. O acesso continua usando URL temporária dos buckets privados e as políticas existentes. Arquivos antigos permanecem acessíveis pelo mesmo caminho registrado.

## Ajuste da V25

Em **Funcionários**, pessoas com permissão de edição podem usar **Importar Funcionários**. O botão **Baixar modelo de importação** entrega um CSV UTF-8 com os campos do cadastro atual. A prévia valida CPF/CNPJ, datas, setor, campos obrigatórios e duplicidades no arquivo e no cadastro. Cada erro mostra a linha e pode ser corrigido na própria prévia. A confirmação salva somente as linhas válidas numa atualização única do cadastro compartilhado; um conflito de versão exige recarregar e validar novamente.

Em **Funcionários > Visualizar > Certificados**, aparecem certificados da Capacitação e certificados externos. Pessoas com permissão de edição em Funcionários podem adicionar, editar, substituir o arquivo e excluir certificados externos. Arquivos PDF, JPG e PNG ficam no bucket privado `employee-certificates`, com links temporários para visualizar ou baixar. O histórico de Capacitação e as regras existentes continuam independentes.

Em **Funcionários > Visualizar > Anexos gerais**, é possível guardar documentos que não são certificados, com nome, categoria e observações. Pessoas com permissão de edição em Funcionários podem adicionar, editar, substituir e excluir esses anexos mediante confirmação. PDF e imagens abrem em nova visualização; DOCX, XLSX e TXT são baixados. Os arquivos ficam no bucket privado `employee-attachments` e seguem as mesmas permissões de Funcionários.

Em **Minhas Capacitações**, os botões **Iniciar** e **Concluir** atualizam o curso logo após o salvamento, sem esperar o recarregamento de todas as trilhas. Se a leitura de confirmação falhar, a tela ainda mostra o estado gravado. O certificado anexado pelo próprio funcionário abre em uma janela do portal, com opções de abrir em outra aba ou baixar. A migração desta versão permite a leitura do certificado já registrado pelo dono da inscrição ativa, mesmo que seu setor tenha sido alterado depois da inscrição; a leitura continua limitada ao caminho do arquivo registrado.

Execute `supabase/migration-v25-employee-files.sql` **antes** de publicar `index.html`, `auth.js` e `employee-tools.js`. A migração cria as tabelas de certificados externos e anexos gerais e seus buckets privados. O cadastro de funcionários permanece no `app_state` existente. Esta versão usa CSV, que pode ser gerado pelo Excel; não há importação direta de `.xlsx`.

## Ajuste da V24

A lista de capacitações permite buscar pelo nome, descrição ou sequência da trilha. Na criação ou edição, o administrador pode informar uma sequência e posição para relacionar trilhas sem bloquear o acesso a nenhuma delas. Também pode escolher certificado por curso ou um certificado único após todos os cursos ativos. O certificado final é anexado pelo funcionário, conferido pelo administrador e pode ser reenviado após recusa. Trilhas existentes continuam com certificado por curso. Execute `supabase/migration-v24-track-sequences-certificates.sql` antes de publicar os arquivos desta versão.

Em projetos que receberam a primeira edição da V24, execute também `supabase/hotfix-v24-track-edit-grant.sql` para permitir que administradores editem os novos campos ao salvar trilhas. A política `cap_tracks_update` continua exigindo o perfil de administrador.

## Ajuste da V23

Em **Funcionários > Gerenciar setores**, um setor pode ser cadastrado sem funcionário vinculado e fica disponível para vinculação posterior. Renomear um setor atualiza também funcionários e trilhas vinculados. Ao criar ou editar uma trilha, marque um ou mais setores destinatários; sem seleção específica, ela serve a todos. O filtro de trilhas por setor inclui as trilhas gerais. A lista de inscrição permite funcionários de qualquer setor marcado.

Execute `supabase/migration-v23-sectors.sql` após a V22 e antes de publicar os arquivos da V23. A migração preserva o setor das trilhas atuais, registra os setores já usados no catálogo e mantém as trilhas gerais disponíveis a todos.

## Ajuste da V22

Cada trilha pode ser destinada a um setor ou a **Todos os setores**. A lista de trilhas ganhou filtro por setor; o setor aparece nos cartões e nos detalhes. Ao criar uma trilha ou inscrever funcionários, a lista mostra apenas pessoas do setor escolhido. A migração `supabase/migration-v22-track-sector.sql` cria o campo e aplica a mesma regra no banco. Execute a migração antes de publicar os arquivos da V22. Trilhas existentes continuam destinadas a todos os setores.

## Ajuste da V21

Em **Capacitação > trilha > Cursos da Trilha**, **Adicionar Curso** e **Editar Curso** abrem um formulário em janela sobreposta. Os campos e o salvamento permanecem os mesmos. A janela pode ser fechada por **Cancelar**, pelo X ou pela tecla Esc. Não há alteração no banco de dados nesta versão.

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
