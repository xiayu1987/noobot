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

## 3) 环境与配置

- `.env`：当前仅示例 `PORT=10061`
- 全局配置：`service/config/global.config.json`
- 示例配置：`service/config/global.config.example.json`
- 用户配置：`workspace/<userId>/config.json`
- 参数配置（`${VAR_NAME}`）：
  - 工作区级：`workspace/config-params.json`
  - 用户级：`workspace/<userId>/config-params.json`
  - 优先级：`process.env` > `config-params.json`

## 4) 认证与权限

- 免鉴权：`GET /health`、`POST /internal/connect`
- 其他接口默认要求 `apiKey`
- 获取 `apiKey`：`POST /internal/connect`（`userId + connectCode`）
- 传递方式：
  - Header `x-api-key`
  - Header `Authorization: Bearer <apiKey>`
  - Query `?apikey=...`
- `/internal/admin/*` 需要超管权限（`superAdmin`）

## 5) API 概览（当前代码）

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

## 6) 关键目录

- `service/system-core/`：核心能力（会话、记忆、工具、MCP、连接器等）
- `service/config/`：全局配置
- `workspace/`：运行时用户数据（会话、文件、附件、配置参数）
- `user-template/default-user/`：新用户工作区模板
