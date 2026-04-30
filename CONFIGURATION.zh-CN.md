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

### 3.2 会话策略

| 键名 | 类型 | 说明 |
|---|---|---|
| `session.recent_message_limit` | number | 上下文中最近消息数量 |
| `session.use_last_running_task_range` | boolean | 优先从最近运行任务开始取上下文 |
| `session.use_last_completed_task_range` | boolean | 优先从最近完成任务开始取上下文 |

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
| `tools.delegate_task_async.wait_timeout_ms` | number | 异步委派等待超时 |
| `tools.delegate_task_async.poll_interval_ms` | number | 异步委派轮询间隔 |
| `tools.delegate_task_async.max_sub_agent_depth` | number | 子任务最大深度 |
| `tools.wait_async_task_result.poll_interval_ms` | number | 等待工具轮询间隔 |
| `tools.process_content_task.max_tool_loop_turns` | number | 内容任务内部循环上限 |
| `tools.process_connector_tool.max_tool_loop_turns` | number | 连接器任务内部循环上限 |
| `tools.access_connector.max_output_chars` | number | 连接器输出最大字符数 |
| `tools.execute_script.sandbox_mode` | boolean | 是否启用脚本沙箱 |
| `tools.execute_script.script_timeout_ms` | number | 脚本超时 |
| `tools.execute_script.sandbox_provider.default` | enum | `docker` / `bubblewrap` / `firejail` |
| `tools.execute_script.sandbox_provider.docker.docker_container_scope` | enum | `global` / `user` |
| `tools.execute_script.sandbox_provider.docker.docker_container_name` | string | Docker 沙箱容器名基础前缀 |
| `tools.execute_script.sandbox_provider.docker.docker_image` | string | Docker 沙箱镜像 |

### 3.5 连接器预置

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

### 3.6 模型提供方（`providers.<alias>`）

| 键名 | 类型 | 说明 |
|---|---|---|
| `enabled` | boolean | 是否启用 |
| `used_for_conversation` | boolean | 是否可用于会话 |
| `api_key` | string | 模型密钥（支持 `${VAR_NAME}`） |
| `base_url` | string(url) | 模型网关地址 |
| `model` | string | 模型名 |
| `format` | enum | `openai_compatible` / `dashscope` |
| `reasoning_effort` | string | 推理强度（模型支持时） |
| `temperature` | number | 采样温度 |
| `max_tokens` | number | 最大输出 token |
| `preserve_thinking` | boolean | 是否保留思考（模型支持时） |
| `thinking_budget` | number | 思考预算（模型支持时） |
| `description` | string | 提供方说明 |
| `multimodal_generation.support_understanding` | boolean | 是否支持多模态理解 |
| `multimodal_generation.support_generation.enabled` | boolean | 是否支持多模态生成 |
| `multimodal_generation.support_generation.support_scope` | string[] | 生成范围（如 `["image"]`） |

### 3.7 MCP 服务（`mcp_servers.<name>`）

| 键名 | 类型 | 说明 |
|---|---|---|
| `type` | enum | `sse` / `streamableHttp` |
| `description` | string | 服务描述 |
| `isActive` | boolean | 是否启用 |
| `name` | string | 展示名称 |
| `baseUrl` | string(url) | MCP 接口地址 |
| `headers` | object | 请求头（支持 `${VAR_NAME}`） |

### 3.8 超级管理员

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
| `providers` | 用户级模型配置覆盖 |
| `mcp_servers` | 用户级 MCP 配置覆盖 |
| `streaming` | 用户级流式设置 |

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
| 历史字段 | 旧 camelCase 逐步迁移 |
| 生效方式 | 修改后建议执行 `./start.sh` 重启 |

