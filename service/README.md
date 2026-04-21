# service（后端）说明

`service/` 是 noobot 的后端运行时，基于 **Express + LangChain**。

## 运行依赖

### Node 依赖

- Node.js 18+（建议 20+）
- npm 9+

### 系统依赖

- `libreoffice`（office 文档转换）
- `ffmpeg`（音视频处理）

> 根目录 `start.sh` 会检查并尝试自动安装 `libreoffice` / `ffmpeg`（需要 sudo/root）。

---

## 运行方式

```bash
cd service
npm install
npm start
```

端口来自 `.env`（默认 `10061`，见 `.env.example`）。

---

## 认证机制

除 `/health` 与 `/internal/connect` 外，接口默认要求 `apiKey`。

- `POST /internal/connect`：用 `userId + connectCode` 获取 `apiKey`
- `apiKey` 可通过以下任一方式传递：
  - Header: `x-api-key`
  - Header: `Authorization: Bearer <apiKey>`
  - Query: `?apikey=...`

---

## 主要能力

- 多用户工作区（`workspace/<userId>`）
- 会话与会话树管理
- 短期/长期记忆管理
- 工具调用与多轮工具循环
- 子任务异步协作（sub-agent）
- MCP 工具调用（支持 `streamableHttp` / `sse`）
- 工作区文件浏览、编辑、下载、重置、增量同步

---

## API 概览（当前）

### 公共

- `GET /health`
- `POST /internal/connect`

### 对话

- `POST /chat`
- `WS /chat/ws`

### 会话

- `GET /internal/session/:userId/:sessionId`
- `GET /internal/sessions/:userId`
- `DELETE /internal/session/:userId/:sessionId`

### 工作区

- `GET /internal/workspace/tree/:userId`
- `GET /internal/workspace/file/:userId?path=...`
- `PUT /internal/workspace/file/:userId`
- `GET /internal/workspace/download/:userId?path=...`
- `POST /internal/workspace/reset/:userId`
- `POST /internal/workspace/sync/:userId`

### 管理（超管）

- `GET /internal/admin/users`
- `PUT /internal/admin/users`
- `GET /internal/admin/config-params`
- `PUT /internal/admin/config-params`
- `GET /internal/admin/template/tree`
- `GET /internal/admin/template/file?path=...`
- `PUT /internal/admin/template/file`

---

## 配置说明（简版）

### 全局配置

- 文件：`service/config/global.config.json`
- 示例：`service/config/global.config.example.json`

关键字段：

- `workspaceRoot`
- `workspaceTemplatePath`
- `providers`
- `defaultProvider`
- `services`
- `mcpServers`
- `superAdmin`

### 用户配置

- 文件：`workspace/<userId>/config.json`

支持覆盖部分全局项（如 providers/services/mcpServers 等）。

### 参数化配置（`${VAR_NAME}`）

配置中可写 `${DASHSCOPE_API_KEY}` 这类占位符。实际值来源优先级：

1. `process.env.VAR_NAME`
2. `workspace/config-params.json`（由“参数配置”界面维护）

---

## 常见目录

- `service/system-core/`：核心能力（context/session/tools/mcp/memory 等）
- `workspace/`：运行时数据（会话、附件、记忆、日志）
- `user-template/default-user/`：新用户工作区模板

