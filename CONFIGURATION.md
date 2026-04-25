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

> 工具配置建议使用“**实际工具名**”（下划线分割）作为 key。  
> `enabled` 缺省为 `true`；只有显式 `false` 才禁用。

#### 2.4.1 文件与脚本类

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `tools.read_file.enabled` | `true` / `false` | 读文件工具开关。 |
| `tools.write_file.enabled` | `true` / `false` | 写文件工具开关。 |
| `tools.execute_script.enabled` | `true` / `false` | 脚本执行工具开关。 |
| `tools.execute_script.sandbox_mode` | `true` / `false` | 脚本沙箱开关。 |
| `tools.execute_script.sandbox_provider.default` | `docker` / `bubblewrap` / `firejail` | 默认沙箱提供方。 |
| `tools.execute_script.sandbox_provider.docker.docker_container_scope` | `global` / `user` | Docker 容器复用范围。 |
| `tools.execute_script.sandbox_provider.docker.docker_container_name` | 字符串 | Docker 容器基础名称。 |
| `tools.execute_script.sandbox_provider.docker.docker_image` | 镜像名 | Docker 镜像。 |
| `tools.execute_script.script_timeout_ms` | 正整数（毫秒） | 脚本超时。 |

#### 2.4.2 技能与服务调用类

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `tools.list_skills.enabled` | `true` / `false` | 列技能工具开关。 |
| `tools.set_skill_task.enabled` | `true` / `false` | 技能任务状态工具开关。 |
| `tools.call_service.enabled` | `true` / `false` | 服务调用工具开关。 |
| `tools.call_mcp_task.enabled` | `true` / `false` | MCP 调用工具开关。 |

#### 2.4.3 多任务协作类

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `tools.delegate_task_async.enabled` | `true` / `false` | 异步委派工具开关。 |
| `tools.delegate_task_async.wait_timeout_ms` | 正整数（毫秒） | 等待超时。 |
| `tools.delegate_task_async.max_sub_agent_depth` | 正整数 | 子任务最大深度。 |
| `tools.wait_async_task_result.enabled` | `true` / `false` | 等待异步结果工具开关。 |
| `tools.plan_multi_task_collaboration.enabled` | `true` / `false` | 多任务规划工具开关。 |

#### 2.4.4 模型与交互类

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `tools.switch_model.enabled` | `true` / `false` | 切模型工具开关。 |
| `tools.user_interaction.enabled` | `true` / `false` | 用户交互工具开关。 |

#### 2.4.5 内容处理类

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `tools.web_to_data.enabled` | `true` / `false` | 网页解析子工具开关（仅 `process_content_task` 内部使用，不是顶层可直接调用工具）。 |
| `tools.web_to_data.switch_web_mode` | `direct` / `browser_simulate` / `multimodal` | 网页解析子工具模式（仅 `process_content_task` 内部使用）。 |
| `tools.doc_to_data.enabled` | `true` / `false` | 文档解析子工具开关（仅 `process_content_task` 内部使用，不是顶层可直接调用工具）。 |
| `tools.process_content_task.enabled` | `true` / `false` | 内容处理任务顶层工具开关。 |
| `tools.process_content_task.max_tool_loop_turns` | 正整数 | 子任务内部工具轮次上限。 |

### 2.5 其他运行参数

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `streaming` | `true` / `false` | 是否启用流式响应。 |

### 2.6 超级管理员

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

用户配置支持覆盖大部分工具项（示例）：

#### 3.3.1 内容处理类（常见用户覆盖）

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `tools.web_to_data.enabled` | `true` / `false` | 用户级网页解析子工具开关（仅 `process_content_task` 内部使用）。 |
| `tools.web_to_data.switch_web_mode` | `direct` / `browser_simulate` / `multimodal` | 用户级网页解析子工具模式覆盖（仅 `process_content_task` 内部使用）。 |
| `tools.doc_to_data.enabled` | `true` / `false` | 用户级文档解析子工具开关（仅 `process_content_task` 内部使用）。 |
| `tools.process_content_task.enabled` | `true` / `false` | 用户级内容处理任务工具开关。 |
| `tools.process_content_task.max_tool_loop_turns` | 正整数 | 用户级内容处理任务内部最大工具轮数。 |

> 注意：`tools.execute_script` 由服务端控制，用户配置不会生效（已在后端禁改）。

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
| `services.<service>.endpoints.<endpoint>.query_string_format` | 字符串 / JSON 字符串 | 查询参数格式说明。 |
| `services.<service>.endpoints.<endpoint>.body_format` | 字符串 / JSON 字符串 | 请求体格式说明。 |

### 3.6 MCP 服务 `mcp_servers`

| 参数名 | 可选项 | 描述 |
|---|---|---|
| `mcp_servers.<name>.type` | `streamableHttp` / `sse` | MCP 连接类型。 |
| `mcp_servers.<name>.description` | 字符串 | MCP 服务描述。 |
| `mcp_servers.<name>.isActive` | `true` / `false` | 是否启用该 MCP 服务。 |
| `mcp_servers.<name>.name` | 字符串（可选） | 展示名。 |
| `mcp_servers.<name>.baseUrl` | URL 字符串 | MCP 服务地址。 |
| `mcp_servers.<name>.headers` | 对象（如 `Authorization`） | 请求头；支持 `${VAR_NAME}` 解析。 |

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

补充限制：

- `workspace_root`、`workspace_template_path`：不允许用户配置覆盖。
- `tools.execute_script`：不允许用户配置覆盖。

---

## 6. 安全建议

- 不要在仓库提交明文密钥（`api_key`、`Bearer sk-...`）
- 推荐使用 `${VAR_NAME}` + `workspace/config-params.json` 或环境变量注入
- `workspace/` 建议加入 `.gitignore`
