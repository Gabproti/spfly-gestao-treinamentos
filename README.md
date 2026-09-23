# SPFLY | Gestão de Treinamentos — V3.15

Versão de teste da plataforma de gestão de treinamentos. O site usa apenas HTML, JavaScript e uma imagem, e pode ser publicado no GitHub Pages.

## Publicar no GitHub Pages

1. Crie um repositório público no GitHub.
2. Envie os arquivos desta pasta para a raiz do repositório. O arquivo `index.html` deve ficar na raiz, ao lado de `spfly_logo.png`.
3. Em **Settings > Pages**, escolha **Deploy from a branch**, a branch `main` e a pasta `/(root)`. Salve.
4. Abra a URL mostrada na mesma tela e teste a plataforma com dados fictícios.

## Limitação desta versão

Funcionários, treinamentos e anexos são armazenados no `localStorage` do navegador. Os dados não são compartilhados entre usuários ou dispositivos, podem ser perdidos quando o armazenamento do navegador é apagado e não constituem um banco de dados ou backup central. O GitHub Pages hospeda a interface, mas não fornece autenticação nem persistência compartilhada.

Esta publicação é adequada para testar a interface. Antes de usar dados reais de funcionários ou operar a gestão de treinamentos em equipe, será necessário implementar autenticação, banco de dados e armazenamento de arquivos com controles de acesso.

O código inclui registros de demonstração exibidos quando não há dados salvos no navegador.
