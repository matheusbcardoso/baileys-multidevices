# Integração WhatsApp Multi-Dispositivos

Sistema de integração com WhatsApp que permite gerenciar múltiplos dispositivos em uma única interface, utilizando a biblioteca [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys).

## Funcionalidades

- **Autenticação de Usuário**
  - Login com usuário e senha fixos (admin / @admin123)
  - Proteção de rotas para usuários não autenticados
  - Logout seguro

- **Gerenciamento de Múltiplos Dispositivos**
  - Adicionar, remover e gerenciar vários dispositivos WhatsApp
  - Visualização do status de conexão em tempo real
  - Reconexão automática de dispositivos

- **Envio de Mensagens**
  - Interface para envio de mensagens de texto
  - Suporte para envio para qualquer número de telefone
  - Histórico de mensagens enviadas

- **Armazenamento de Dados**
  - Utilização de SQLite para armazenamento de dispositivos e mensagens
  - Persistência de sessões entre reinicializações do servidor

## Tecnologias Utilizadas

- **Backend**
  - Node.js
  - Express
  - Socket.io para comunicação em tempo real
  - SQLite (better-sqlite3)
  - @whiskeysockets/baileys para API do WhatsApp

- **Frontend**
  - HTML5, CSS3, JavaScript
  - Bootstrap 5 para interface responsiva
  - Socket.io Client para atualizações em tempo real

## Instalação

1. Clone o repositório:
   ```
   git clone [URL_DO_REPOSITÓRIO]
   cd baileys
   ```

2. Instale as dependências:
   ```
   npm install
   ```

3. Inicie o servidor:
   ```
   node index.js
   ```

4. Acesse a aplicação em:
   ```
   http://localhost:3000
   ```

## Estrutura do Projeto

- `index.js` - Arquivo principal do servidor
- `database.js` - Configuração e operações do banco de dados
- `public/` - Arquivos estáticos (HTML, CSS, JavaScript)
  - `index.html` - Interface principal
  - `login.html` - Tela de login
  - `logout.html` - Página de logout
  - `script.js` - Lógica do frontend
  - `styles.css` - Estilos da aplicação
- `sessions/` - Armazenamento das sessões do WhatsApp

## Uso

1. Faça login com as credenciais:
   - Usuário: `admin`
   - Senha: `@admin123`

2. Adicione um novo dispositivo clicando em "Novo"

3. Escaneie o QR Code com o WhatsApp do seu celular

4. Após conectado, utilize a interface para enviar mensagens

## Licença

Este projeto está licenciado sob a licença MIT - consulte o arquivo LICENSE para obter detalhes.

## Contribuição

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou enviar pull requests com melhorias.