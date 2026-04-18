# service（后端）说明

`service/` 是 noobot 的 Agent 后端，基于 **Express + LangChain**。

## 主要能力

- 多用户工作区隔离（`workspaceRoot/<userId>`，含附件与运行时目录）
- 会话管理
- 长短期记忆管理（short/long memory，支持阈值与窗口配置）
- Agent + 工具执行（文件/脚本/技能/外部服务/文档解析/模型切换）
- 多 Agent 异步协作
- HTTP + WebSocket 双通道响应（普通 JSON 与流式事件）
- 工作区文件与附件访问接口（树结构、读写、下载、附件直链）


> 注：`node_modules/` 为依赖目录，文档中省略。

## 运行方式

```bash
cd service
npm install
npm start
```

默认端口来自 `.env` 中的 `PORT`（示例见 `.env.example`，默认 `10061`）。

## 认证机制（重要）

除 `/health` 和 `/internal/connect` 外，其它接口都需要 `apiKey`。

### 1) 获取 apiKey

`POST /internal/connect`

请求体：

```json
{
  "userId": "xxx",
  "connectCode": "xxx"
}
```

说明：

- 普通用户从 `workspaceRoot/user.json` 校验 `userId + connectCode`
- 超管从 `global.config.json.superAdmin` 校验
- `apiKey` 存在内存中（进程重启后失效），并受 TTL 控制（默认 24h）

### 2) 传 apiKey

可用任一方式：

- Header: `x-api-key: <apiKey>`
- Header: `Authorization: Bearer <apiKey>`
- Query: `?apikey=<apiKey>`

## API 概览（当前实现）

### 公共

- `GET /health`
- `POST /internal/connect`

### 对话

- `POST /chat`
- `WS /chat/ws`

请求字段（HTTP/WS 一致）：

- `userId`（必填）
- `sessionId`（必填，必须是 UUID）
- `message`（必填）
- `parentSessionId`（可选，UUID）
- `attachments`（可选）

### 会话查询

- `GET /internal/session/:userId/:sessionId`
- `GET /internal/sessions/:userId`

### 工作区文件管理

- `GET /internal/workspace/tree/:userId`
- `GET /internal/workspace/file/:userId?path=...`
- `PUT /internal/workspace/file/:userId`
- `GET /internal/workspace/download/:userId?path=...`

### 附件访问

- `GET /internal/attachment/:userId/:attachmentId`


## 工具（tools）清单

当前注册工具：

- `read_file` / `write_file`
- `execute_script`
- `list_skills` / `set_skill_task`
- `doc_to_data`
- `call_service`
- `delegate_task_async` / `wait_async_task_result`
- `write_task_deliverable_file` / `read_task_deliverable_file`
- `plan_execution_flow`
- `switch_model`

## 配置说明

后端配置分两层：

1. 全局配置：`service/config/global.config.json`
2. 用户配置：`workspaces/<userId>/config.json`（会覆盖同名全局项）

### 1) 全局配置（global.config.json）

常用字段：

- `workspaceRoot`：工作区根目录（默认 `../workspaces`）
- `workspaceTemplatePath`：新用户工作区初始化模板目录（必填，例如 `../user-template/default-user`）
- `defaultProvider`：默认模型别名（需在 `providers` 中存在）
- `providers`：模型提供方配置集合（按别名组织）
  - 典型字段：`enabled`、`api_key`、`base_url`、`model`、`format`、`temperature`、`max_tokens`
- `attachmentModels`：附件处理模型映射（`audio/video/image`）
- `sessionToShortMemoryThreshold`：会话写入短记忆阈值
- `shortMemory*` / `longMemoryWindow`：短/长记忆策略
- `maxToolLoopTurns`：单轮推理最大工具循环次数
- `session.*`：会话上下文裁剪策略
- `script.sandboxMode`：脚本工具是否启用 Docker 沙箱
- `scriptTimeoutMs`：脚本执行超时
- `async.*`：多 Agent 异步协作配置（等待超时/最大深度）
- `streaming`：是否启用流式输出
- `superAdmin.userId/connectCode`：超管连接凭据

### 2) 用户配置（workspaces/<userId>/config.json）

用户配置用于个性化或覆盖全局配置，当前项目里常见有：

- `services`：供 `call_service` 工具调用的外部服务定义
  - 服务下可配置 `enabled`、`api_key`、`handler`、`endpoints`
- `preferences`：偏好设置（如 `language`）

示例（当前仓库）：

`workspaces/default-user/config.json` 已包含 `webSearchService`、`weatherService` 示例。

### 3) 配置生效优先级

一般规则：**用户配置 > 全局配置 > 代码默认值**。

例如：模型、服务开关、部分运行策略会按该优先级合并。

> 安全建议：`api_key`、`connectCode` 等敏感信息不要提交到公开仓库，建议使用环境变量或私有配置注入。
