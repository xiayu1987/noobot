# 配置说明

中文 | [English](./CONFIGURATION.md)

本文档基于最新示例：

- `service/config/global.config.example.json`
- `user-template/default-user/config.example.json`
- `service/.env.example`

---

## 1）配置文件位置

| 范围 | 路径 | 说明 |
|---|---|---|
| 全局配置 | `service/config/global.config.json` | 系统级运行配置 |
| 全局示例 | `service/config/global.config.example.json` | 最新参考模板 |
| 用户模板 | `user-template/default-user/config.json` | 默认用户配置模板 |
| 用户运行配置 | `workspace/<userId>/config.json` | 单用户生效配置 |
| 系统参数 | `workspace/config-params.json` | 全局占位符参数 |
| 用户参数 | `workspace/<userId>/config-params.json` | 用户占位符参数 |
| 环境变量文件 | `service/.env` | 后端环境变量（示例：`.env.example`） |

---

## 2）环境变量

| 键名 | 类型 | 示例 | 说明 |
|---|---|---|---|
| `PORT` | number | `10061` | 后端监听端口 |
| `NOOBOT_SESSION_LOG_ROOT` | string(path) | `../workspace/session-logs` | 后端日志 WebSocket 写入 session 日志文件的目录。默认相对后端进程 cwd 为 `../workspace/session-logs`。 |
| `NOOBOT_SESSION_LOG_RETENTION_MS` | number | `604800000` | session 日志保留时间（毫秒）。默认 7 天，过期的 session 日志目录会由后端清理任务删除。 |
| `NOOBOT_SESSION_LOG_CLEANUP_INTERVAL_MS` | number | `3600000` | 后端清理过期 session 日志的间隔。 |
| `NOOBOT_RUNTIME_EVENT_STATE_LOG` | boolean | `true` | runtime-events 是否记录状态类 session 日志。 |
| `NOOBOT_RUNTIME_EVENT_MESSAGE_LOG` | boolean | `true` | runtime-events 是否记录消息类 session 日志。 |
| `NOOBOT_RUNTIME_EVENT_INTERACTION_LOG` | boolean | `true` | runtime-events 是否记录交互类 session 日志。 |
| `NOOBOT_RUNTIME_EVENT_TRANSPORT_LOG` | boolean | `true` | runtime-events 是否记录传输类 session 日志。 |
| `NOOBOT_RUNTIME_EVENT_AGENT_PROXY_LOG` | boolean | `true` | runtime-events 是否记录 agent-proxy 类 session 日志。 |
| `NOOBOT_RUNTIME_EVENT_SYSTEM_LOG` | boolean | `true` | runtime-events 是否记录系统类 session 日志。 |
| `NOOBOT_RUNTIME_EVENT_STATE_MACHINE_DEBUG` | boolean | `false` | runtime-events 是否记录状态机专项 debug。 |
| `NOOBOT_RUNTIME_EVENT_RESEND_DEBUG` | boolean | `false` | runtime-events 是否记录重发专项 debug。 |
| `NOOBOT_RUNTIME_EVENT_SESSION_LOG_WS_DEBUG` | boolean | `false` | runtime-events 是否记录 session 日志 WebSocket 专项 debug。 |

Session 日志 WebSocket：
- 入口：后端 `/logs/ws`，前端通常通过 `/api/logs/ws` 访问，agent-proxy 通过后端 upstream 访问。
- 鉴权：复用现有 API key WebSocket 鉴权。
- 存储：后端按 `sessionId` 建目录，并按分类写 JSONL 文件（`state`、`message`、`interaction`、`transport`、`debug`、`agent-proxy`、`system`）。
- 主要字段：`source`、`category`、`event`、`sessionId`，可选 `dialogProcessId` / `turnScopeId`，以及用于状态机、消息流、前后端交互和 agent-proxy 事件的精简 `data` 载荷。
- 控制：前端和 agent-proxy 只通过日志 WebSocket 发送事件；是否记录统一由 runtime-events 按 `runtime-events-config.mjs` 中的具体业务小类型开关决定。日志专项默认开启，debug 专项默认关闭。

---

## 3）全局配置（`global.config.json`）

### 3.1 核心字段

| 键名 | 类型 | 说明 |
|---|---|---|
| `workspace_root` | string(path) | 工作区根目录 |
| `workspace_template_path` | string(path) | 用户初始化模板目录 |
| `default_provider` | string | 默认模型别名 |
| `memory_max_items` | number | 短期记忆条目上限 |
| `max_tool_loop_turns` | number | 单轮工具调用循环上限 |
| `streaming` | boolean | 是否启用流式输出 |
| `run_timeout_ms` | number | 单次运行超时（毫秒），如 `7200000` |

### 3.2 会话策略

模型历史上下文由 agent 运行时固定处理：保留最新 5 个 `dialogProcessId/dialogId` 轮次。会话历史窗口不提供配置项。

### 3.3 附件策略

| 键名 | 类型 | 说明 |
|---|---|---|
| `attachments.max_file_count` | number | 单次请求最大附件数 |
| `attachments.max_file_size_bytes` | number | 单文件大小上限 |
| `attachments.max_total_size_bytes` | number | 总上传大小上限 |
| `attachments.allowed_extensions` | string[] | 允许后缀白名单 |
| `attachments.attachment_models.audio` | string | 音频处理默认模型别名 |
| `attachments.attachment_models.video` | string | 视频处理默认模型别名 |
| `attachments.attachment_models.image` | string | 图片处理默认模型别名 |

### 3.4 工具配置

> 所有工具统一支持：`tools.<tool_name>.enabled`

| 键名 | 类型 | 说明 |
|---|---|---|
| `tools.read_file.enabled` | boolean | 启用文件读取工具 |
| `tools.write_file.enabled` | boolean | 启用文件写入工具 |
| `tools.list_skills.enabled` | boolean | 启用技能列表工具 |
| `tools.set_skill_task.enabled` | boolean | 启用技能任务工具 |
| `tools.call_service.enabled` | boolean | 启用外部服务调用工具 |
| `tools.call_mcp_task.enabled` | boolean | 启用 MCP 任务工具 |
| `tools.delegate_task_async.enabled` | boolean | 启用异步委派工具 |
| `tools.delegate_task_async.wait_timeout_ms` | number | 异步委派等待超时 |
| `tools.delegate_task_async.poll_interval_ms` | number | 异步委派轮询间隔 |
| `tools.delegate_task_async.max_sub_agent_depth` | number | 子任务最大深度 |
| `tools.wait_async_task_result.enabled` | boolean | 启用等待异步结果工具 |
| `tools.wait_async_task_result.poll_interval_ms` | number | 等待工具轮询间隔 |
| `tools.plan_multi_task_collaboration.enabled` | boolean | 启用任务规划工具 |
| `tools.switch_model.enabled` | boolean | 启用模型切换工具 |
| `tools.user_interaction.enabled` | boolean | 启用用户交互工具 |
| `tools.web_to_data.enabled` | boolean | 启用网页内容提取工具 |
| `tools.web_to_data.switch_web_mode` | string | 网页提取模式（如 `browser_simulate`） |
| `tools.doc_to_data.enabled` | boolean | 启用文档解析工具 |
| `tools.doc_to_data.parse_engine` | string | 文档解析引擎（默认 `libreoffice`） |
| `tools.process_content_task.enabled` | boolean | 启用内容处理工具 |
| `tools.process_content_task.max_tool_loop_turns` | number | 内容任务内部循环上限 |
| `tools.execute_script.enabled` | boolean | 启用脚本执行工具 |
| `tools.execute_script.sandbox_mode` | boolean | 是否启用脚本沙箱 |
| `tools.execute_script.script_timeout_ms` | number | 脚本超时 |
| `tools.execute_script.sandbox_provider.default` | enum | `docker` / `bubblewrap` / `firejail` |
| `tools.execute_script.sandbox_provider.docker.docker_container_scope` | enum | `global` / `user` |
| `tools.execute_script.sandbox_provider.docker.docker_container_name` | string | Docker 沙箱容器名基础前缀 |
| `tools.execute_script.sandbox_provider.docker.docker_image` | string | Docker 沙箱镜像 |
| `tools.execute_script.sandbox_provider.docker.docker_lock_wait_timeout_ms` | number | 并发复用同名 Docker 容器时的最大排队等待时长（毫秒） |
| `tools.execute_script.sandbox_provider.docker.docker_mounts` | object[] | 额外目录映射列表（可选） |
| `tools.execute_script.sandbox_provider.docker.docker_mounts[].source` | string(path) | 宿主机目录 |
| `tools.execute_script.sandbox_provider.docker.docker_mounts[].target` | string(path) | 容器内目录（会自动规范成 `/xxx`） |
| `tools.execute_script.sandbox_provider.docker.docker_mounts[].description` | string | 映射说明（可选） |
| `tools.process_connector_tool.enabled` | boolean | 启用连接器处理工具 |
| `tools.process_connector_tool.max_tool_loop_turns` | number | 连接器任务内部循环上限 |
| `tools.access_connector.enabled` | boolean | 启用连接器访问工具 |
| `tools.access_connector.command_file.enabled` | boolean | 启用 access_connector 的 `command_file_path` 输入 |
| `tools.access_connector.command_file.max_bytes` | number | 命令文件可读取的最大字节数 |
| `tools.access_connector.command_file.allowed_extensions` | string[] | 命令文件后缀白名单 |
| `tools.access_connector.command_file.allowed_roots` | string(path)[] | 命令文件路径白名单根目录（为空时默认工作区根目录） |
| `tools.max_output_chars` | number | 工具输出清洗与截断的统一长度上限 |
| `tools.database_connect_connector.enabled` | boolean | 启用数据库连接器工具 |
| `tools.terminal_connect_connector.enabled` | boolean | 启用终端连接器工具 |
| `tools.inspect_connectors.enabled` | boolean | 启用连接器检查工具 |
| `tools.multimodal_generate.enabled` | boolean | 启用多模态生成工具 |
| `tools.task_summary.enabled` | boolean | 启用阶段小结工具 |
| `tools.task_summary.phase_summary_loop_turns` | number | 触发阶段小结的对话轮数阈值 |
| `tools.request_help.enabled` | boolean | 启用请求帮助工具 |
| `tools.request_help.help_services` | string[]/object[] | 帮助服务列表（默认空；网页搜索使用 `web_search` 工具） |
| `tools.request_help.help_model` | string | 帮助模型别名/名称（留空按当前/默认模型逻辑） |
| `tools.request_help.help_prompt_loop_turns` | number | 触发系统帮助提示的工具循环阈值（默认 50） |
| `tools.request_help.tool_failure_help_count` | number | 触发用户帮助提示的连续失败阈值（默认 3） |
| `tools.email_connect_connector.enabled` | boolean | 启用邮件连接器工具 |

大上下文长度阈值默认值：
- 阶段小结字符阈值：225000
- semantic-transfer 直传阈值：30000 字符
- semantic-transfer 工具结果 inline 阈值：30000 字符
- semantic-transfer 工具输入 overflow 阈值：30000 字符

长度相关阈值统一集中在 `@noobot/shared/length-thresholds`（`shared/length-thresholds.mjs`）。后续调整字符数、字节数、字符串预览长度时优先改这个包导出。

说明：
- `docker_mounts` 不配置或为空时，不添加额外挂载。
- 单条映射仅在 `source` 与 `target` 同时非空时生效。
- 当前仓库默认值：
  - `service/config/global.config.json`：默认挂载本项目到 `/project`
  - `service/config/global.config.example.json`：不默认挂载项目目录

### 3.5 情景配置

| 键名 | 类型 | 说明 |
|---|---|---|
| `scenarios.default` | string | 默认情景键（仅支持内置 `full` / `programming`；请求未设置 `config.scenario` 时使用） |
| `scenarios.definitions.programming.model` | string | 编程情景默认运行模型别名/模型名（请求未设置 `runtimeModel` 时生效） |

情景定义现在由系统内置，只保留两个固定情景：
- `full`（全能，默认）：tools/context/services/mcp_servers 均为 `["*"]`，表示不额外限制。
- `programming`（编程）：固定使用代码任务策略，包含代码修改必要工具、代码上下文段和 `web_search` 工具；配置文件只允许覆盖 `model`。

用户配置或全局配置中的其它字段（如 `name`、`description`、`tools`、`context`、`services`、`mcp_servers`，以及自定义情景定义）会被忽略，避免破坏内置行为。

### 3.5.1 插件配置

| 键名 | 类型 | 说明 |
|---|---|---|
| `plugins.<name>.enabled` | boolean | 插件总开关。为 `false` 时前端不展示且运行时禁用。 |
| `plugins.<name>.mode` | enum | 插件默认运行模式。目前支持 `on` / `off`（`off` 表示插件可用但默认不激活）。 |
| `plugins.harness.stepModels.<purpose>` | string | Harness 各步骤模型别名（`planning` / `guidance` / `acceptance` / `default`）。 |

当前仓库插件默认值：
- `plugins.harness.enabled = true`
- `plugins.harness.mode = "off"`
- `plugins.harness.stepModels = { planning, guidance, acceptance, default }`（当前示例中均为 `"qwen3_6_plus"`）

### 3.6 连接器预置

#### 数据库连接器（`tools.database_connect_connector.connectors.<name>`）

| 键名 | 类型 | 说明 |
|---|---|---|
| `database_type` | enum | `mysql` / `postgres` / `sqlite` |
| `host` | string | 数据库主机（mysql/postgres） |
| `port` | number | 数据库端口 |
| `username` | string | 数据库用户名 |
| `password` | string | 数据库密码（建议 `${VAR_NAME}`） |
| `database` | string | 数据库名（mysql/postgres） |
| `file_path` | string(path) | SQLite 文件路径 |

#### 终端连接器（`tools.terminal_connect_connector.connectors.<name>`）

| 键名 | 类型 | 说明 |
|---|---|---|
| `terminal_type` | enum | `ssh` |
| `host` | string | SSH 主机 |
| `port` | number | SSH 端口 |
| `username` | string | SSH 用户名 |
| `password` | string | SSH 密码（建议 `${VAR_NAME}`） |

#### 邮件连接器（`tools.email_connect_connector.connectors.<name>`）

| 键名 | 类型 | 说明 |
|---|---|---|
| `smtp_host` | string | SMTP 服务器地址 |
| `smtp_port` | number/string | SMTP 端口 |
| `imap_host` | string | IMAP 服务器地址 |
| `imap_port` | number/string | IMAP 端口 |
| `username` | string | 邮件账号 |
| `password` | string | 邮箱授权码/密码 |
| `from_email` | string | 默认发件人 |
| `to_email` | string | 默认收件人 |

### 3.7 模型提供方（`providers.<alias>`）

| 键名 | 类型 | 说明 |
|---|---|---|
| `providers.<alias>.enabled` | boolean | 是否启用 |
| `providers.<alias>.used_for_conversation` | boolean | 是否可用于会话 |
| `providers.<alias>.api_key` | string | 模型密钥（支持 `${VAR_NAME}`） |
| `providers.<alias>.base_url` | string(url) | 模型网关地址 |
| `providers.<alias>.model` | string | 模型名 |
| `providers.<alias>.format` | enum | `openai_compatible` / `dashscope` |
| `providers.<alias>.reasoning_effort` | string | 推理强度（模型支持时） |
| `providers.<alias>.enable_thinking` | boolean | 可选思考开关（常见于 dashscope 兼容模型） |
| `providers.<alias>.temperature` | number | 采样温度 |
| `providers.<alias>.max_tokens` | number | 最大输出 token |
| `providers.<alias>.top_p` | number | 可选 nucleus sampling 参数 |
| `providers.<alias>.frequency_penalty` | number | 可选频率惩罚参数 |
| `providers.<alias>.presence_penalty` | number | 可选存在惩罚参数 |
| `providers.<alias>.preserve_thinking` | boolean | 是否保留思考（模型支持时） |
| `providers.<alias>.thinking_budget` | number | 思考预算（模型支持时） |
| `providers.<alias>.description` | string | 提供方说明 |
| `providers.<alias>.multimodal_generation.support_understanding` | boolean | 是否支持多模态理解 |
| `providers.<alias>.multimodal_generation.support_generation.enabled` | boolean | 是否支持多模态生成 |
| `providers.<alias>.multimodal_generation.support_generation.support_scope` | string[] | 生成范围（如 `["image"]`） |

模型系列默认参数、Prompt Cache 命中优化、`use_responses_api` 策略见：`docs/model-provider-adaptation-cache.md`。

### 3.8 MCP 服务（`mcp_servers.<name>`）

| 键名 | 类型 | 说明 |
|---|---|---|
| `mcp_servers.<name>.type` | enum | `sse` / `streamableHttp` |
| `mcp_servers.<name>.description` | string | 服务描述 |
| `mcp_servers.<name>.prompt` | string | MCP 提示词（注入系统提示块） |
| `mcp_servers.<name>.isActive` | boolean | 是否启用 |
| `mcp_servers.<name>.name` | string | 展示名称 |
| `mcp_servers.<name>.baseUrl` | string(url) | MCP 接口地址 |
| `mcp_servers.<name>.headers` | object | 请求头（支持 `${VAR_NAME}`） |

### 3.9 超级管理员

| 键名 | 类型 | 说明 |
|---|---|---|
| `super_admin.user_id` | string | 超级管理员 ID |
| `super_admin.connect_code` | string | 超级管理员连接码 |

---

## 4）用户配置（`workspace/<userId>/config.json`）

用户配置可覆盖全局默认值。

| 模块 | 说明 |
|---|---|
| `default_provider` | 用户默认模型 |
| `attachments` | 用户级附件策略覆盖 |
| `tools` | 用户级工具开关/参数覆盖 |
| `scenarios` | 用户级情景选择/编程模型覆盖（只允许 `default` 与 `definitions.programming.model`） |
| `plugins` | 用户级插件开关/默认模式覆盖 |
| `providers` | 用户级模型配置覆盖 |
| `services` | 用户级外部服务定义（见 §4.1） |
| `mcp_servers` | 用户级 MCP 配置覆盖 |
| `preferences` | 用户偏好设置（如 `language`） |
| `preferences.language` | string | 界面/交互语言，如 `zh-CN` / `en-US` |
| `streaming` | 用户级流式设置 |

### 4.1 外部服务（`services.<name>`）

用户级外部服务定义，供 `call_service` 工具使用。

| 键名 | 类型 | 说明 |
|---|---|---|
| `services.<name>.enabled` | boolean | 是否启用该服务 |
| `services.<name>.api_key` | string | 服务 API 密钥（可选） |
| `services.<name>.handler` | string | 处理器名称 |
| `services.<name>.prompt` | string | 服务级提示词（注入系统提示块） |
| `services.<name>.endpoints.<epName>.description` | string | 端点描述 |
| `services.<name>.endpoints.<epName>.prompt` | string | 端点级提示词（注入系统提示块） |
| `services.<name>.endpoints.<epName>.url` | string(url) | 端点 URL（支持 `${VAR_NAME}`） |
| `services.<name>.endpoints.<epName>.query_string_format` | string | 查询参数模板 |
| `services.<name>.endpoints.<epName>.body_format` | string | 请求体模板 |
| `services.<name>.endpoints.<epName>.custom_param_format` | string | 自定义参数模板 |

当前仓库默认：
- `weather_service`：通过 `wttr.in` 查询天气

网页搜索由 `web_search` 工具提供，不再通过外部服务提供。

### 4.2 插件配置（`plugins.<name>`）

| 键名 | 类型 | 说明 |
|---|---|---|
| `plugins.<name>.enabled` | boolean | 用户级插件开关覆盖。 |
| `plugins.<name>.mode` | enum | 用户级默认模式覆盖（`on` / `off`）。 |

---

## 5）占位符解析（`${VAR_NAME}`）

| 来源 | 路径 |
|---|---|
| 用户参数 | `workspace/<userId>/config-params.json` |
| 系统参数 | `workspace/config-params.json` |
| 环境变量 | 进程环境变量 |

推荐写法：

```json
{ "api_key": "${DASHSCOPE_API_KEY}" }
```

---

## 6）迁移建议

| 项目 | 建议 |
|---|---|
| 字段命名 | 使用最新示例中的 snake_case |
| 历史字段 | 不再兼容，请统一使用 snake_case 字段 |
| 生效方式 | 修改后建议执行 `./start.sh` 重启 |
