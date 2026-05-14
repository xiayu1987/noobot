# noobot service

中文 | [English](./README.md)

`service/` 是 noobot 的后端运行时，基于 **Express 5 + WebSocket + LangChain**。

## 1) 运行依赖

- Node.js 18+（建议 20+）
- npm 9+
- 可选系统依赖：
  - `libreoffice`（Office 文档转换）
  - `ffmpeg`（音视频处理）
  - `docker` / `bubblewrap(bwrap)` / `firejail`（仅在启用 `tools.execute_script.sandbox_mode=true` 时用于脚本沙箱）

## 2) 启动方式

```bash
cd service
npm install
npm start
```

开发模式：

```bash
npm run dev
```

PM2（项目内置 `.pm2`）：

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:logs
```

## 3) 测试

```bash
cd service
npm test
```

仅运行 tools 层测试：

```bash
npm run test:tools
```

`test:tools` 会覆盖 `__tests__/system-core/tools/*.test.js`，包含 agent-collab 拆分后的测试，例如：

- `agent-collab-passthrough.test.js`
- `agent-collab-wait.test.js`
- `agent-collab-container-store.test.js`
- `agent-collab-delegate-wait-flow.test.js`

## 4) 环境与配置

- `.env`：当前仅示例 `PORT=10061`
- 全局配置：`service/config/global.config.json`
- 示例配置：`service/config/global.config.example.json`
- 用户配置：`workspace/<userId>/config.json`
- 参数配置（`${VAR_NAME}`）：
  - 工作区级：`workspace/config-params.json`
  - 用户级：`workspace/<userId>/config-params.json`
  - 优先级：`process.env` > `config-params.json`

## 5) 认证与权限

- 免鉴权：`GET /health`、`POST /internal/connect`
- 其他接口默认要求 `apiKey`
- 获取 `apiKey`：`POST /internal/connect`（`userId + connectCode`）
- 传递方式：
  - Header `x-api-key`
  - Header `Authorization: Bearer <apiKey>`
  - Query `?apikey=...`
- `/internal/admin/*` 需要超管权限（`superAdmin`）

## 6) API 概览（当前代码）

- 公共
  - `GET /health`
  - `POST /internal/connect`
- 对话
  - `POST /chat`
  - `WS /chat/ws`
- 配置参数
  - `GET /internal/config-params`
  - `PUT /internal/config-params`
  - `GET /internal/config-params/catalog`
  - `GET /internal/admin/config-params`
  - `PUT /internal/admin/config-params`
- 会话与连接器
  - `GET /internal/session/:userId/:sessionId`
  - `DELETE /internal/session/:userId/:sessionId`
  - `GET /internal/sessions/:userId`
  - `GET /internal/connectors/:userId/:sessionId`
  - `PUT /internal/connectors/:userId/:sessionId/selection`
- 工作区（用户）
  - `GET /internal/workspace/tree/:userId`
  - `GET /internal/workspace/file/:userId?path=...`
  - `PUT /internal/workspace/file/:userId`
  - `GET /internal/workspace/download/:userId?path=...`
  - `POST /internal/workspace/reset/:userId`
  - `POST /internal/workspace/sync/:userId`
  - `GET /internal/attachment/:userId/:attachmentId`
- 管理（超管）
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

## 7) 关键目录

```
service/
├── app.js                      # 应用入口（Express 应用 + 服务启动）
├── bootstrap/                  # 应用初始化
│   ├── create-app-dependencies.js
│   ├── register-global-middlewares.js
│   ├── register-http-modules.js
│   └── start-http-server.js
├── config/                     # 全局配置文件
├── routes/                     # HTTP 路由模块
│   ├── auth-routes.js
│   ├── config-template-routes.js
│   ├── connectors-routes.js
│   ├── file-crud-routes.js           # 通用文件 CRUD 路由工厂（tree/read/write/download）
│   ├── session-routes.js
│   └── workspace-routes.js
├── services/                   # 业务服务
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
├── system-core/                # 核心能力
│   ├── agent/                  # Agent 引擎（核心、上下文、执行、模型、媒体）
│   ├── attach/                 # 附件处理
│   ├── bot-manage/             # Bot 生命周期管理
│   ├── config/                 # 配置加载与解析
│   ├── connectors/             # 连接器运行时（数据库、邮件、终端）
│   ├── context/                # 上下文组装
│   ├── error/                  # 错误处理
│   ├── event/                  # 事件系统
│   ├── i18n/                   # 国际化
│   ├── init/                   # 初始化
│   ├── mcp/                    # MCP 客户端
│   ├── memory/                 # 短期/长期记忆
│   ├── model/                  # 模型抽象层
│   ├── sandbox/                # 脚本沙箱提供方
│   ├── service-invoker/        # 外部服务调用
│   ├── session/                # 会话管理
│   ├── skill/                  # 技能系统
│   ├── system-prompt/          # 系统提示词模板
│   ├── tools/                  # Agent 工具
│   ├── tracking/               # 日志与诊断
│   └── utils/                  # 工具函数
├── ws/                         # WebSocket 服务
│   └── chat-websocket-server.js
└── scripts/                    # 工具脚本
    └── check-openai-tool-schema.js
```

- `workspace/`：运行时用户数据（会话、文件、附件、配置参数）
- `user-template/default-user/`：新用户工作区模板
