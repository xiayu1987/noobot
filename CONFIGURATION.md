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

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `PORT` | 端口号（如 `10061`） | 后端服务监听端口。配置文件：`service/.env`（示例：`service/.env.example`）。 |

---

## 2. 全局配置（`global.config.json`）

> 以下字段基于 `service/config/global.config.example.json`。

### 2.1 基础路径

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `workspaceRoot` | 路径字符串（示例：`../workspace`） | 工作区根目录。 |
| `workspaceTemplatePath` | 路径字符串（示例：`../user-template/default-user`） | 用户初始化模板目录。 |

### 2.2 记忆与推理

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `memoryMaxItems` | 正整数 | 短期记忆最大条目数；达到阈值触发长期记忆提炼。 |
| `maxToolLoopTurns` | 正整数 | 单轮对话中工具循环最大轮次。 |

### 2.3 会话上下文策略 `session`

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `session.recentMessageLimit` | 正整数 | 最近消息回看数量。 |
| `session.useLastRunningTaskRange` | `true` / `false` | 是否优先取“最近运行任务开始之后”的消息范围。 |
| `session.useLastCompletedTaskRange` | `true` / `false` | 是否优先取“最近完成任务之后”的消息范围。 |

### 2.4 工具配置 `tools`

> `tools` 支持全局与用户同名覆盖；常见做法是全局给默认值，用户按需覆写。

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `tools.web_search_to_data.enabled` | `true` / `false` | 是否启用网页搜索并解析工具。 |
| `tools.web_search_to_data.searchMode` | `direct` / `browser_simulate` | 搜索模式：`direct`=HTTP 直接抓搜索页；`browser_simulate`=浏览器模拟打开搜索页。 |
| `tools.web_search_to_data.switchWebMode` | `direct` / `browser_simulate` / `multimodal` | 搜索命中链接后的网页处理模式。 |
| `tools.web_search_to_data.maxCandidates` | `1~30` 整数 | 搜索结果候选链接上限。 |
| `tools.web_search_to_data.topK` | `1~10` 整数 | 送入网页解析流程的最终链接数上限。 |
| `tools.web_to_data.enabled` | `true` / `false` | 是否启用网页解析工具。 |
| `tools.web_to_data.switchWebMode` | `direct` / `browser_simulate` / `multimodal` | 网页解析模式：直连抓取 / 浏览器模拟 / 多模态截图。 |
| `tools.doc_to_data.enabled` | `true` / `false` | 是否启用文档解析工具。 |
| `tools.process_content_task.enabled` | `true` / `false` | 是否启用内容处理任务工具（子 bot 协同）。 |
| `tools.process_content_task.maxToolLoopTurns` | 正整数（建议 `1~10`） | 内容处理任务内部最大工具循环轮数。 |

### 2.5 脚本执行 `script`

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `script.sandboxMode` | `true` / `false` | 是否启用沙箱模式。`true` 时按 `sandboxProvider.default` 执行；`false` 时本机 local 执行。 |
| `script.sandboxProvider` | 对象 | 沙箱提供方配置对象（见下方结构与子项）。 |

`script.sandboxProvider` 结构：

```json
{
  "sandboxProvider": {
    "default": "docker",
    "docker": {
      "dockerContainerScope": "global",
      "dockerContainerName": "noobot-script-sandbox",
      "dockerImage": "node:20"
    },
    "bubblewrap": {},
    "firejail": {}
  }
}
```

`sandboxProvider` 子项：

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `script.sandboxProvider.default` | `docker` / `bubblewrap` / `firejail` | 默认沙箱提供方。 |
| `script.sandboxProvider.docker.dockerContainerScope` | `global` / `user` | Docker 容器复用范围：`global`=所有用户共用同一容器（默认）；`user`=每用户独立容器。 |
| `script.sandboxProvider.docker.dockerContainerName` | 合法容器名字符串 | Docker 容器基础名称；`user` 模式会拼接 userId。 |
| `script.sandboxProvider.docker.dockerImage` | 任意可拉取镜像（如 `node:20`） | Docker 执行镜像。 |
| `script.sandboxProvider.bubblewrap` | 对象（当前可为空 `{}`） | Bubblewrap 专属参数预留。 |
| `script.sandboxProvider.firejail` | 对象（当前可为空 `{}`） | Firejail 专属参数预留。 |

### 2.6 异步协作 `async`

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `async.waitTimeoutMs` | 正整数（毫秒） | 异步任务等待超时。 |
| `async.maxSubAgentDepth` | 正整数 | 子任务最大深度。 |

### 2.7 其他运行参数

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `scriptTimeoutMs` | 正整数（毫秒） | 脚本执行超时。 |
| `streaming` | `true` / `false` | 是否启用流式响应。 |

### 2.8 超级管理员

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `superAdmin.userId` | 字符串 | 超级管理员用户 ID。 |
| `superAdmin.connectCode` | 字符串 | 超级管理员连接码。 |

---

## 3. 用户配置（`workspace/<userId>/config.json`）

> 以下字段来自默认模板 `user-template/default-user/config.json`。

### 3.1 模型选择

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `defaultProvider` | `providers` 中已启用别名（如 `qwen3_5_flash`） | 默认模型别名。 |

### 3.2 附件模型映射 `attachmentModels`

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `attachmentModels.audio` | `providers` 中模型别名 | 音频处理默认模型。 |
| `attachmentModels.video` | `providers` 中模型别名 | 视频处理默认模型。 |
| `attachmentModels.image` | `providers` 中模型别名 | 图片处理默认模型。 |

### 3.3 工具配置 `tools`

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `tools.web_search_to_data.enabled` | `true` / `false` | 用户级网页搜索并解析工具开关。 |
| `tools.web_search_to_data.searchMode` | `direct` / `browser_simulate` | 用户级搜索模式覆盖。 |
| `tools.web_search_to_data.switchWebMode` | `direct` / `browser_simulate` / `multimodal` | 用户级网页处理模式覆盖。 |
| `tools.web_search_to_data.maxCandidates` | `1~30` 整数 | 用户级候选链接上限覆盖。 |
| `tools.web_search_to_data.topK` | `1~10` 整数 | 用户级最终解析链接数上限覆盖。 |
| `tools.web_to_data.enabled` | `true` / `false` | 用户级网页解析工具开关。 |
| `tools.web_to_data.switchWebMode` | `direct` / `browser_simulate` / `multimodal` | 用户级网页解析模式覆盖。 |
| `tools.doc_to_data.enabled` | `true` / `false` | 用户级文档解析工具开关。 |
| `tools.process_content_task.enabled` | `true` / `false` | 用户级内容处理任务工具开关。 |
| `tools.process_content_task.maxToolLoopTurns` | 正整数（建议 `1~10`） | 用户级内容处理任务内部最大工具轮数。 |

### 3.4 模型提供方 `providers`

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `providers.<provider>.enabled` | `true` / `false` | 是否启用该模型配置。 |
| `providers.<provider>.api_key` | 明文密钥 / `${VAR_NAME}` | 模型密钥（建议用占位符）。 |
| `providers.<provider>.base_url` | URL 字符串 | 模型网关地址。 |
| `providers.<provider>.model` | 模型名字符串 | 实际调用模型名。 |
| `providers.<provider>.format` | `openai_compatible` / `dashscope` / 其他适配值 | 协议格式。 |
| `providers.<provider>.reasoning_effort` | `low` / `medium` / `high`（视模型支持） | 推理强度。 |
| `providers.<provider>.temperature` | 数值（通常 `0~2`） | 温度参数。 |
| `providers.<provider>.max_tokens` | 正整数 | 最大输出 token。 |
| `providers.<provider>.preserve_thinking` | `true` / `false`（视模型支持） | 是否保留思考。 |
| `providers.<provider>.thinking_budget` | 正整数（视模型支持） | 思考预算。 |
| `providers.<provider>.description` | 字符串 | 提供方说明。 |

### 3.5 外部服务 `services`

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `services.<service>.enabled` | `true` / `false` | 服务开关。 |
| `services.<service>.api_key` | 字符串 / `${VAR_NAME}` | 服务密钥（可选）。 |
| `services.<service>.handler` | `workspace/<userId>/services/*.js` 对应处理器名 | 服务处理器名称。 |
| `services.<service>.endpoints.<endpoint>.description` | 字符串 | 端点描述。 |
| `services.<service>.endpoints.<endpoint>.url` | URL 字符串 | 端点地址。 |
| `services.<service>.endpoints.<endpoint>.query-string-format` | 字符串 / JSON 字符串 | 查询参数格式说明。 |
| `services.<service>.endpoints.<endpoint>.body-format` | 字符串 / JSON 字符串 | 请求体格式说明。 |

### 3.6 MCP 服务 `mcpServers`

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `mcpServers.<name>.type` | `streamableHttp` / `sse` | MCP 连接类型。 |
| `mcpServers.<name>.description` | 字符串 | MCP 服务描述。 |
| `mcpServers.<name>.isActive` | `true` / `false` | 是否启用该 MCP 服务。 |
| `mcpServers.<name>.name` | 字符串（可选） | 展示名。 |
| `mcpServers.<name>.baseUrl` | URL 字符串 | MCP 服务地址。 |
| `mcpServers.<name>.headers` | 对象（如 `Authorization`） | 请求头；支持 `${VAR_NAME}` 解析。 |

### 3.7 用户偏好 `preferences`

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `preferences.language` | 语言代码（如 `zh-CN`、`en-US`） | 语言偏好。 |

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

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `${VAR_NAME}` | 取值来源：`process.env` / `workspace/config-params.json` / 空字符串 | 运行时解析优先级：`process.env.VAR_NAME` > `workspace/config-params.json.values.VAR_NAME` > `""`。 |

---

## 5. 配置覆盖关系

| 参数名 | 可选项 | 描述 |
|---|---|---|
| 同名配置项覆盖顺序 | 全局配置 -> 用户配置 | 先加载 `global.config.json`，再加载 `workspace/<userId>/config.json`；同名项由用户配置覆盖。 |

---

## 6. 安全建议

- 不要在仓库提交明文密钥（`api_key`、`Bearer sk-...`）
- 推荐使用 `${VAR_NAME}` + `workspace/config-params.json` 或环境变量注入
- `workspace/` 建议加入 `.gitignore`
