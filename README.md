# SPFLY Admin — V11

A V10 organiza a tela de acessos como lista compacta. Cada linha mostra nome, e-mail, perfil, telas liberadas e status. Há busca por nome, e-mail ou tela e filtro por perfil. O administrador abre "Editar acesso" apenas para a pessoa desejada; as permissões e regras da V9 permanecem as mesmas.

Administradores também podem excluir um treinamento pela tela de detalhes. O registro deixa de aparecer no calendário e nos relatórios, mas pode ser recuperado em **Treinamentos > Ver excluídos**. A exclusão preserva participantes e anexos para restauração. Usuários comuns não recebem a ação de excluir ou restaurar.

## Ajustes da V11

- O botão de remoção de anexos do treinamento é um X vermelho compacto, com nome acessível e confirmação antes da remoção.
- É possível editar um funcionário existente em **Funcionários > Editar**. A matrícula, o documento, o nome, o setor, o cargo, as datas, o contato e o status são atualizados no mesmo registro.
- O menu Cadastros saiu da navegação. A gestão de setores fica em **Funcionários > Gerenciar setores**. Setores existentes podem ser renomeados para todos os funcionários vinculados. Para criar um setor, escolha **Novo setor** e salve um funcionário com ele; o setor passa a constar dos dados compartilhados.
- A navegação principal segue Início, Treinamentos, Capacitação, Funcionários e Relatórios; Acessos continua disponível para administradores.
- Certificados da Capacitação mostram **Pendente**, **Certificado anexado** e **Concluído** conforme o fluxo de conferência administrativa. A lista de inscritos resume esses estados por funcionário.

## Atualização da V10

Publique `index.html`, `capacitation.js` e este `README.md` na raiz do repositório GitHub Pages. Não há migração de banco nem alteração na Edge Function para esta versão. Mantenha os demais arquivos da V10.

## Instalação nova

Use as instruções da V9 para configurar Supabase, autenticação, banco e função de cadastro. Depois publique os arquivos desta versão.
