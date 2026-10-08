# SPFLY Admin — V40

## Código do documento à esquerda (V40)

O código de identificação agora ocupa uma linha própria no início do cabeçalho impresso, alinhada à margem esquerda da página. O logo e o título permanecem no cabeçalho.

## Correção de cabeçalho impresso (V39)

O cabeçalho da Lista de Presença e do Relatório de Treinamento agora participa do fluxo normal da página impressa, dentro das margens A4. Isso mantém visíveis o logo, o identificador e o nome do documento na prévia e no PDF. A correção altera somente `training-print.css` e a referência de versão em `index.html`.

## Cabeçalhos de impressão (V38)

A Lista de Presença, o Relatório de Treinamento e a Avaliação de Desempenho usam o arquivo `spfly_print_logo.png` no canto superior esquerdo. No mesmo bloco, acima do logo, aparece o identificador do documento. O Relatório de Treinamento mantém `F - 5.0 - 000`; os demais conservam `REV. 00` até receberem códigos próprios. O logo anterior continua nas telas do portal. Publique `spfly_print_logo.png`, `index.html`, `training-print.js`, `training-print.css`, `performance.js` e `performance.css` juntos.

## Menu Formulários e importação de competências (V33)

**Formulários** agora é um menu próprio, com Competências, Modelos de Avaliação e Histórico de Avaliações. A lista de competências permite cadastrar, editar e inativar. **Importar Competências** lê a primeira aba de um arquivo Excel `.xlsx` ou `.xls` (até 5 MB e 500 linhas) com as colunas Competência, Significado e Peso Máximo. A prévia mostra pesos inválidos e nomes duplicados antes da confirmação; o banco confirma todas as linhas juntas ou nenhuma. Pesos aceitos: 0% a 100%, com até duas casas decimais. O leitor de Excel é carregado sob demanda do CDN oficial do SheetJS.

Os três modelos padrão, a ordem de competências, a criação e impressão das avaliações permanecem. O histórico agora filtra por colaborador, departamento, modelo, responsável, período e status. A escrita continua restrita a administradores ou usuários com edição simultânea em Funcionários e Treinamentos.

Execute `supabase/migration-v33-forms-import.sql` após a V32 e antes de publicar `index.html`, `auth.js`, `performance.js` e `performance.css` V33. Ela preserva os dados existentes e acrescenta a importação atômica de competências.

## Ações no histórico de avaliações (V32)

Em **Formulários > Histórico de Avaliações**, usuários com acesso de leitura a Funcionários e Treinamentos podem visualizar e imprimir avaliações. Administradores e usuários com edição nas duas telas também podem editar e excluir. A edição altera os dados registrados do colaborador, responsável, data e percentuais, recalcula o resultado e mantém competência, significado e peso como cópias fixas da avaliação. Cada edição registra o estado anterior para auditoria. Excluir exige confirmação e marca a avaliação como removida, sem apagar modelos, competências ou funcionários.

Execute `supabase/migration-v32-evaluation-actions.sql` após a V31 e antes de publicar `index.html`, `auth.js`, `performance.js` e `performance.css` V32.

## Avaliação de Desempenho (V31)

Em **Treinamentos > Formulários**, administradores e usuários com permissão de edição simultânea em Funcionários e Treinamentos podem cadastrar competências, compor modelos, criar avaliações, salvar rascunhos, finalizar, consultar o histórico e imprimir em A4. A implantação cria três modelos vazios: Lideranças, Administrativo e Operacional. Cadastre competências e distribua pesos que somem 100% em cada modelo antes de finalizar avaliações.

Execute `supabase/migration-v31-performance-evaluations.sql` após a V30. As avaliações usam dados do cadastro de funcionários e preservam cópias dos dados do colaborador, modelo e competências no momento da criação. Avaliações finalizadas ficam imutáveis. As novas tabelas têm RLS e concedem leitura apenas aos perfis autorizados; a escrita ocorre por funções com validação no banco. O script `supabase/hotfix-v30-course-id-ambiguity.sql` documenta a correção pontual de salvamento de curso já aplicada ao ambiente de produção.

## Sistema definido na trilha (V30)

Em **Capacitação > Nova/Editar Trilha**, selecione TMS, WMS ou ambos. Todos os cursos da trilha herdam essa classificação. A lista de trilhas tem filtro por sistema, combinado com busca e setor. A classificação aparece na trilha, nos cursos herdados, na ficha do funcionário e no relatório de carga horária. A liberação individual de cursos continua funcionando como exceção.

Execute `supabase/migration-v30-track-systems.sql` depois da V29 e antes de publicar os arquivos V30. Ela consolida na trilha os sistemas já marcados nos cursos da V29; se uma trilha tiver cursos de sistemas diferentes, recebe ambos. Trilhas antigas sem classificação continuam disponíveis até serem editadas. A migração preserva cursos, inscrições, progresso e liberações individuais.

## Classificação por sistema (V29, substituída pela V30)

No cadastro de curso, selecione TMS, WMS ou ambos e, se necessário, escolha funcionários específicos no mesmo formulário. Em **Funcionários > Novo/Editar**, marque os sistemas usados pela pessoa. A classificação atua junto com o setor e a inscrição; uma liberação individual continua permitindo o curso escolhido. Cursos anteriores sem classificação permanecem disponíveis pelas regras atuais até serem editados. O sistema aparece nos cursos, no perfil do funcionário e no relatório de carga horária, que também tem filtro e exportação CSV com essa coluna.

Execute `supabase/migration-v29-course-systems.sql` antes de publicar os arquivos V29. A migração cria um catálogo de sistemas e vínculos separados para cursos e funcionários, sem converter nem excluir registros existentes.

## Ajuste da V28

Em **Funcionários > Novo/Editar**, a seção **Cursos específicos** permite buscar e marcar cursos para uma pessoa. A liberação individual soma-se às inscrições de trilha e às regras de setor; desmarcar remove apenas a liberação individual. A área **Minhas Capacitações** exibe somente os cursos liberados nessa inscrição individual, com início, conclusão e certificado conforme as regras do curso. A relação funcionário–curso é única, protegida por RLS e alterada apenas por quem pode editar Funcionários. Execute `supabase/migration-v28-individual-courses.sql` antes de publicar `index.html` e `capacitation.js`.

## Ajuste da V27

Em **Treinamentos > Detalhes**, o botão **Imprimir** abre o diálogo padrão do navegador. A impressão mostra as informações da tela; o modelo definitivo do documento será definido depois.

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
## Ajustes da V34

Na tela de detalhes de **Treinamentos**, o botão **Salvar treinamento** grava informações, anexos, observações, planejamento de eficácia e eventual mudança de status em uma ação. Participantes continuam no seletor próprio e o resultado da avaliação de eficácia continua sendo um registro separado. O menu lateral **Formulários** abre diretamente sua tela principal, mantendo os atalhos internos.

Em **Formulários > Modelos**, cada competência recebe um peso próprio por modelo. A soma é informativa e pode ser diferente de 100%. Os pesos atuais são copiados para os vínculos de cada modelo durante a migração; avaliações existentes conservam os pesos registrados no momento em que foram criadas. O cadastro global e a importação de competências agora usam apenas **Competência** e **Significado**; planilhas antigas com a coluna adicional **Peso Máximo** continuam aceitas e essa coluna é ignorada. Novas avaliações usam os pesos do modelo selecionado.

Antes de publicar `index.html`, `performance.js` e `performance.css`, execute `supabase/migration-v34-model-weights.sql` no projeto Supabase correspondente. A migração precisa ocorrer primeiro porque remove o campo global de peso e troca as funções de cadastro/importação. Faça uma cópia do banco antes da migração de produção.

## Ajustes da V35

A **Avaliação de Eficácia** é individual para cada participante de um treinamento concluído. O responsável escolhe um modelo de avaliação existente, informa data, resultado, nota, evidência e avaliador. A tela do treinamento mostra pendências, avaliações concluídas e percentual; o perfil do funcionário e os relatórios exibem o histórico individual. A remoção do participante invalida automaticamente sua avaliação por exclusão lógica. O banco impede duas avaliações ativas para o mesmo par treinamento/funcionário.

Registros antigos de eficácia que pertenciam ao treinamento inteiro permanecem no bloco recolhível **Registros anteriores do treinamento**. Eles não são atribuídos a funcionários nem contam nos novos indicadores.

Para publicar, execute **V34 antes de V35**: `supabase/migration-v34-model-weights.sql` e depois `supabase/migration-v35-individual-efficacy.sql`. Em seguida publique `index.html`, `auth.js`, `performance.js`, `performance.css`, `efficacy.js`, `efficacy.css` e os demais arquivos do portal.

## Ajustes da V36

Na tela de detalhes de um treinamento há dois documentos separados: **Imprimir Lista de Presença**, com linhas amplas para assinatura física, e **Imprimir Extrato**, com dados do treinamento, participantes, situação das avaliações individuais e nomes dos anexos. Ambos exibem **REV. 00** no cabeçalho de todas as páginas impressas. A revisão de cada documento está centralizada em `training-print.js`.

Os documentos consultam os dados atuais do Supabase no momento da impressão. O Extrato requer acesso às avaliações individuais. Treinamentos novos passam a registrar a data de cadastro; para registros anteriores sem essa data o documento exibe “Não informado”.

Para publicar esta versão, execute primeiro as migrações V34 e V35, na ordem descrita acima. Depois publique também `training-print.js` e `training-print.css`, junto com os demais arquivos da pasta.

### Implantação em um único SQL

Se V34 e V35 ainda não foram aplicadas, execute apenas `supabase/migration-v36-combined-v34-v35.sql` no SQL Editor do projeto correto. Esse arquivo reúne as duas migrações na ordem necessária em uma única transação: se alguma instrução falhar, nenhuma alteração é confirmada. Depois publique os arquivos V36. Não execute o combinado em um banco que já tenha recebido V34 ou V35 separadamente.

Implantação da V36: migração combinada V34/V35 aplicada no projeto spfly-treinamentos e arquivos publicados no GitHub Pages em 06/10/2026.

## Ajustes da V37 — Relatório de Treinamento

O documento impresso antes chamado **Extrato do Treinamento** agora se chama **Relatório de Treinamento**. O logo da SPFLY permanece no canto superior esquerdo e o código **F - 5.0 - 000** aparece no canto superior direito; o código fica definido em `training-print.js` para futuras revisões.

O documento deixa de imprimir Setor / público-alvo, Cadastro, Evidências registradas e Anexos. Os participantes aparecem em ordem alfabética, sem coluna de numeração, em uma tabela de quatro colunas dimensionadas para a página A4. A coluna Participação permanece inteiramente dentro das margens. A Lista de Presença e os dados de gestão na tela não foram alterados. Esta versão não exige migração do banco; publique `index.html`, `training-print.js` e `training-print.css` juntos.

