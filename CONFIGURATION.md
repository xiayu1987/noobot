# 配置说明（完整）

本文档汇总 noobot 当前所有主要配置项，包括全局配置、用户配置、参数化变量与环境变量。

---

## 1. 配置文件位置

### 1.1 全局配置

- 文件：`service/config/global.config.json`
- 示例：`service/config/global.config.example.json`

### 1.2 用户配置

- 模板：`user-template/default-user/config.json`
- 运行时：`workspace/<userId>/config.json`

### 1.3 参数化变量配置

- 文件：`workspace/config-params.json`
- 用途：给 `${VAR_NAME}` 这类占位符提供值（可在前端“参数配置”界面维护）

### 1.4 运行端口

- 文件：`service/.env`
- 示例：`service/.env.example`
- 关键项：`PORT`

---

## 2. 全局配置（`global.config.json`）

> 以下字段基于 `service/config/global.config.example.json`。

### 2.1 基础路径

- `workspaceRoot`：工作区根目录（默认 `../workspace`）
- `workspaceTemplatePath`：用户初始化模板目录（默认 `../user-template/default-user`）

### 2.2 记忆与推理

- `memoryMaxItems`：短期记忆最大条目数，达到阈值触发长期记忆提炼
- `maxToolLoopTurns`：单轮对话中工具循环最大轮次

### 2.3 会话上下文策略 `session`

- `recentMessageLimit`：最近消息回看数量
- `useLastRunningTaskRange`：是否优先取“最近运行任务开始之后”的消息范围
- `useLastCompletedTaskRange`：是否优先取“最近完成任务之后”的消息范围

### 2.4 脚本执行 `script`

- `sandboxMode`：脚本是否启用沙箱模式

### 2.5 异步协作 `async`

- `waitTimeoutMs`：异步任务等待超时
- `maxSubAgentDepth`：子任务最大深度

### 2.6 其他运行参数

- `scriptTimeoutMs`：脚本执行超时（毫秒）
- `streaming`：是否启用流式响应

### 2.7 超级管理员

- `superAdmin.userId`：超管账号
- `superAdmin.connectCode`：超管连接码

---

## 3. 用户配置（`workspace/<userId>/config.json`）

> 以下字段来自默认模板 `user-template/default-user/config.json`。

### 3.1 模型选择

- `defaultProvider`：默认模型别名

### 3.2 附件模型映射 `attachmentModels`

- `audio`：音频默认模型
- `video`：视频默认模型
- `image`：图片默认模型

### 3.3 模型提供方 `providers`

每个 provider（如 `openai` / `qwen3_5_flash`）支持：

- `enabled`：是否启用
- `api_key`：模型密钥（建议使用 `${VAR_NAME}`）
- `base_url`：模型网关地址
- `model`：模型名
- `format`：协议格式（如 `openai_compatible`、`dashscope`）
- `reasoning_effort`：推理强度（部分模型支持）
- `temperature`：温度参数
- `max_tokens`：最大输出 token
- `preserve_thinking`：是否保留思考（部分模型支持）
- `thinking_budget`：思考预算（部分模型支持）
- `description`：描述文本

### 3.4 外部服务 `services`

每个服务（如 `webSearchService` / `weatherService`）支持：

- `enabled`：服务开关
- `api_key`：服务密钥（可选）
- `handler`：服务处理器名称（对应 `workspace/<userId>/services/*.js`）
- `endpoints`：端点集合
  - `description`
  - `url`
  - `query-string-format`
  - `body-format`

### 3.5 MCP 服务 `mcpServers`

每个 MCP server（如 `amap-maps` / `china-railway` / `WebParser`）支持：

- `type`：`streamableHttp` 或 `sse`
- `description`：描述
- `isActive`：是否启用
- `name`：可选展示名
- `baseUrl`：MCP 地址
- `headers`：请求头（常见为 `Authorization`）

### 3.6 用户偏好 `preferences`

- `language`：语言偏好（示例：`zh-CN`）

---

## 4. 参数化变量（`${VAR_NAME}`）

### 4.1 使用方式

在配置中可直接写：

```json
{
  "api_key": "${DASHSCOPE_API_KEY}"
}
```

### 4.2 解析优先级

运行时统一解析入口，优先级如下：

1. `process.env.VAR_NAME`
2. `workspace/config-params.json` 中的 `values.VAR_NAME`
3. 若都没有，则替换为空字符串

---

## 5. 配置覆盖关系

一般生效规则：

1. 先加载全局配置（`global.config.json`）
2. 再加载用户配置（`workspace/<userId>/config.json`）
3. 按白名单字段进行合并覆盖（用户配置覆盖全局同名项）

---

## 6. 安全建议

- 不要在仓库提交明文密钥（`api_key`、`Bearer sk-...`）
- 推荐使用 `${VAR_NAME}` + `workspace/config-params.json` 或环境变量注入
- `workspace/` 建议加入 `.gitignore`

