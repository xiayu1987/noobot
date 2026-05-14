# noobot service

[中文](./README.zh-CN.md) | English

`service/` is the backend runtime of noobot, built with **Express 5 + WebSocket + LangChain**.

## 1) Requirements

- Node.js 18+ (20+ recommended)
- npm 9+
- Optional system dependencies:
  - `libreoffice` (Office document conversion)
  - `ffmpeg` (audio/video processing)
  - `docker` / `bubblewrap (bwrap)` / `firejail` (used only when `tools.execute_script.sandbox_mode=true`)

## 2) Run

```bash
cd service
npm install
npm start
```

Dev mode:

```bash
npm run dev
```

PM2 (project-local `.pm2`):

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:logs
```

## 3) Tests

```bash
cd service
npm test
```

Tool-layer tests only:

```bash
npm run test:tools
```

`test:tools` includes `__tests__/system-core/tools/*.test.js`, including agent-collab split tests such as:

- `agent-collab-passthrough.test.js`
- `agent-collab-wait.test.js`
- `agent-collab-container-store.test.js`
- `agent-collab-delegate-wait-flow.test.js`

## 4) Env & Config

- `.env`: example includes `PORT=10061`
- Global config: `service/config/global.config.json`
- Example config: `service/config/global.config.example.json`
- User config: `workspace/<userId>/config.json`
- Param config (`${VAR_NAME}`):
  - workspace-level: `workspace/config-params.json`
  - user-level: `workspace/<userId>/config-params.json`
  - priority: `process.env` > `config-params.json`

## 5) Auth & Permission

- No auth required for: `GET /health`, `POST /internal/connect`
- All other endpoints require `apiKey`
- Get `apiKey` via `POST /internal/connect` with `userId + connectCode`
- Supported ways to pass `apiKey`:
  - Header `x-api-key`
  - Header `Authorization: Bearer <apiKey>`
  - Query `?apikey=...`
- `/internal/admin/*` requires `superAdmin`

## 6) API Overview (current code)

- Public
  - `GET /health`
  - `POST /internal/connect`
- Chat
  - `POST /chat`
  - `WS /chat/ws`
- Config Params
  - `GET /internal/config-params`
  - `PUT /internal/config-params`
  - `GET /internal/config-params/catalog`
  - `GET /internal/admin/config-params`
  - `PUT /internal/admin/config-params`
- Sessions & Connectors
  - `GET /internal/session/:userId/:sessionId`
  - `DELETE /internal/session/:userId/:sessionId`
  - `GET /internal/sessions/:userId`
  - `GET /internal/connectors/:userId/:sessionId`
  - `PUT /internal/connectors/:userId/:sessionId/selection`
- Workspace (user)
  - `GET /internal/workspace/tree/:userId`
  - `GET /internal/workspace/file/:userId?path=...`
  - `PUT /internal/workspace/file/:userId`
  - `GET /internal/workspace/download/:userId?path=...`
  - `POST /internal/workspace/reset/:userId`
  - `POST /internal/workspace/sync/:userId`
  - `GET /internal/attachment/:userId/:attachmentId`
- Admin
  - `GET /internal/admin/users`
  - `PUT /internal/admin/users`
  - `GET /internal/admin/template/tree`
  - `GET /internal/admin/template/file?path=...`
  - `PUT /internal/admin/template/file`
  - `GET /internal/admin/workspace-all/tree`
  - `GET /internal/admin/workspace-all/file?userId=...&path=...`
  - `PUT /internal/admin/workspace-all/file`
  - `GET /internal/admin/workspace-all/download?userId=...&path=...`
  - `POST /internal/admin/workspace-all/sync`
  - `POST /internal/admin/workspace-all/reset`

## 7) Key Directories

```
service/
├── app.js                      # Application entry (Express app + server start)
├── bootstrap/                  # App initialization
│   ├── create-app-dependencies.js
│   ├── register-global-middlewares.js
│   ├── register-http-modules.js
│   └── start-http-server.js
├── config/                     # Global configuration files
├── routes/                     # HTTP route modules
│   ├── auth-routes.js
│   ├── config-template-routes.js
│   ├── connectors-routes.js
│   ├── file-crud-routes.js           # Generic file CRUD route factory (tree/read/write/download)
│   ├── session-routes.js
│   └── workspace-routes.js
├── services/                   # Business services
│   ├── auth-service.js
│   ├── chat-run-service.js
│   ├── config-params-service.js
│   ├── config-scope-service.js
│   ├── request-context-service.js
│   ├── runtime-config-service.js
│   ├── workspace-path-service.js
│   ├── workspace-tree-service.js
│   ├── workspace-users-service.js
│   └── zip-service.js
├── system-core/                # Core capabilities
│   ├── agent/                  # Agent engine (core, context, execution, model, media)
│   ├── attach/                 # Attachment handling
│   ├── bot-manage/             # Bot lifecycle management
│   ├── config/                 # Config loading & resolution
│   ├── connectors/             # Connector runtime (databases, emails, terminals)
│   ├── context/                # Context assembly
│   ├── error/                  # Error handling
│   ├── event/                  # Event system
│   ├── i18n/                   # Internationalization
│   ├── init/                   # Initialization
│   ├── mcp/                    # MCP client
│   ├── memory/                 # Short/long-term memory
│   ├── model/                  # Model abstraction
│   ├── sandbox/                # Script sandbox providers
│   ├── service-invoker/        # External service invocation
│   ├── session/                # Session management
│   ├── skill/                  # Skill system
│   ├── system-prompt/          # System prompt templates
│   ├── tools/                  # Agent tools
│   ├── tracking/               # Logging & diagnostics
│   └── utils/                  # Utilities
├── ws/                         # WebSocket server
│   └── chat-websocket-server.js
└── scripts/                    # Utility scripts
    └── check-openai-tool-schema.js
```

- `workspace/`: runtime user data (sessions, files, attachments, config params)
- `user-template/default-user/`: template for new user workspace
