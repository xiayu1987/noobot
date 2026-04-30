# 配置说明

中文 | [English](./CONFIGURATION.md)

本文档基于以下最新示例文件整理：

- `service/config/global.config.example.json`
- `user-template/default-user/config.example.json`
- `service/.env.example`

---

## 1）配置文件位置

### 全局配置

- `service/config/global.config.json`
- 示例：`service/config/global.config.example.json`

### 用户配置

- 模板：`user-template/default-user/config.json`
- 运行时：`workspace/<userId>/config.json`

### 参数文件（用于 `${VAR_NAME}`）

- 系统参数：`workspace/config-params.json`
- 用户参数：`workspace/<userId>/config-params.json`

用于给配置中的占位符提供值。

### 环境变量

- `service/.env`（示例：`service/.env.example`）
- 当前必要项：
  - `PORT`（示例默认 `10061`）

---

## 2）全局配置（`global.config.json`）

### 2.1 核心字段

- `workspace_root`
- `workspace_template_path`
- `default_provider`
- `memory_max_items`
- `max_tool_loop_turns`
- `streaming`

### 2.2 会话策略

`session`：

- `recent_message_limit`
- `use_last_running_task_range`
- `use_last_completed_task_range`

### 2.3 附件策略

`attachments`：

- `max_file_count`
- `max_file_size_bytes`
- `max_total_size_bytes`
- `allowed_extensions`
- `attachment_models.audio`
- `attachment_models.video`
- `attachment_models.image`

### 2.4 工具配置

所有工具均支持：`tools.<tool_name>.enabled`。  
当前示例包含：

- `read_file`
- `write_file`
- `list_skills`
- `set_skill_task`
- `call_service`
- `call_mcp_task`
- `delegate_task_async`
- `wait_async_task_result`
- `plan_multi_task_collaboration`
- `switch_model`
- `user_interaction`
- `web_to_data`
- `doc_to_data`
- `process_content_task`
- `execute_script`
- `process_connector_tool`
- `access_connector`
- `database_connect_connector`
- `terminal_connect_connector`
- `email_connect_connector`
- `inspect_connectors`
- `multimodal_generate`

#### 常见工具扩展字段

- `delegate_task_async.wait_timeout_ms`
- `delegate_task_async.poll_interval_ms`
- `delegate_task_async.max_sub_agent_depth`
- `wait_async_task_result.poll_interval_ms`
- `process_content_task.max_tool_loop_turns`
- `process_connector_tool.max_tool_loop_turns`
- `access_connector.max_output_chars`
- `execute_script.sandbox_mode`
- `execute_script.script_timeout_ms`
- `execute_script.sandbox_provider.default`（`docker` / `bubblewrap` / `firejail`）
- `execute_script.sandbox_provider.docker.*`

### 2.5 连接器预置

#### 数据库连接器

`tools.database_connect_connector.connectors.<name>`：

- `database_type`（`mysql` / `postgres` / `sqlite`）
- `host`
- `port`
- `username`
- `password`（建议 `${VAR_NAME}`）
- `database`（mysql/postgres）
- `file_path`（sqlite）

#### 终端连接器

`tools.terminal_connect_connector.connectors.<name>`：

- `terminal_type`（`ssh`）
- `host`
- `port`
- `username`
- `password`（建议 `${VAR_NAME}`）

#### 邮件连接器

`tools.email_connect_connector.connectors.<name>`：

- `smtp_host`
- `smtp_port`
- `imap_host`
- `imap_port`
- `username`
- `password`
- `from_email`
- `to_email`

### 2.6 模型提供方

`providers.<alias>` 常见字段：

- `enabled`
- `used_for_conversation`
- `api_key`
- `base_url`
- `model`
- `format`（`openai_compatible` / `dashscope`）
- `reasoning_effort`（模型支持时）
- `temperature`
- `max_tokens`
- `preserve_thinking`（模型支持时）
- `thinking_budget`（模型支持时）
- `description`
- `multimodal_generation.support_understanding`
- `multimodal_generation.support_generation.enabled`
- `multimodal_generation.support_generation.support_scope`

当前示例别名：

- `gemini_3_flash`
- `nano_banana`
- `qwen3_6_plus_2026_04_02`
- `qwen3_5_omni_plus`

### 2.7 MCP 服务

`mcp_servers.<name>`：

- `type`（`sse` / `streamableHttp`）
- `description`
- `isActive`
- `name`
- `baseUrl`
- `headers`（支持 `${VAR_NAME}`）

### 2.8 超级管理员

`super_admin`：

- `user_id`
- `connect_code`

---

## 3）用户配置（`workspace/<userId>/config.json`）

用户配置可覆盖全局默认行为。

主要结构：

- `default_provider`
- `attachments`（与全局同结构）
- `tools`（与全局同结构）
- `providers`（与全局同结构）
- `mcp_servers`（与全局同结构）
- `streaming`
- `super_admin`（可选）

---

## 4）占位符解析

推荐写法：

```json
{
  "api_key": "${DASHSCOPE_API_KEY}"
}
```

常见来源：

1. `workspace/<userId>/config-params.json`
2. `workspace/config-params.json`
3. 环境变量

（实际优先级以运行时代码路径为准。）

---

## 5）迁移建议

- 以最新 `*.example.json` 的 **snake_case** 字段为准。
- 若存在旧的 camelCase 字段，建议逐步迁移。
- 配置变更后建议重启服务（推荐 `./start.sh`）。

