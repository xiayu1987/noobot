# Configuration

[中文](./CONFIGURATION.zh-CN.md) | English

Based on latest examples:

- `service/config/global.config.example.json`
- `user-template/default-user/config.example.json`
- `service/.env.example`

---

## 1) File Locations

| Scope | Path | Description |
|---|---|---|
| Global config | `service/config/global.config.json` | System-wide runtime config |
| Global example | `service/config/global.config.example.json` | Latest reference template |
| User template | `user-template/default-user/config.json` | Default user config template |
| User runtime config | `workspace/<userId>/config.json` | Per-user effective config |
| System params | `workspace/config-params.json` | Placeholder values for all users |
| User params | `workspace/<userId>/config-params.json` | Placeholder values for one user |
| Env file | `service/.env` | Backend env vars (example: `.env.example`) |

---

## 2) Environment Variables

| Key | Type | Example | Description |
|---|---|---|---|
| `PORT` | number | `10061` | Backend listen port |

---

## 3) Global Config (`global.config.json`)

### 3.1 Core

| Key | Type | Description |
|---|---|---|
| `workspace_root` | string(path) | Workspace root directory |
| `workspace_template_path` | string(path) | Default user template path |
| `default_provider` | string | Default model provider alias |
| `memory_max_items` | number | Short-memory item limit |
| `max_tool_loop_turns` | number | Max tool loop turns per request |
| `streaming` | boolean | Enable SSE streaming output |

### 3.2 Session

| Key | Type | Description |
|---|---|---|
| `session.recent_message_limit` | number | Number of recent messages in context |
| `session.use_last_running_task_range` | boolean | Prefer context since last running task |
| `session.use_last_completed_task_range` | boolean | Prefer context since last completed task |

### 3.3 Attachments

| Key | Type | Description |
|---|---|---|
| `attachments.max_file_count` | number | Max files per request |
| `attachments.max_file_size_bytes` | number | Max size per file |
| `attachments.max_total_size_bytes` | number | Max total upload size |
| `attachments.allowed_extensions` | string[] | Allowed suffix whitelist |
| `attachments.attachment_models.audio` | string | Provider alias for audio understanding |
| `attachments.attachment_models.video` | string | Provider alias for video understanding |
| `attachments.attachment_models.image` | string | Provider alias for image understanding |

### 3.4 Tools

> All tools support: `tools.<tool_name>.enabled`.

| Key | Type | Description |
|---|---|---|
| `tools.delegate_task_async.wait_timeout_ms` | number | Async task wait timeout |
| `tools.delegate_task_async.poll_interval_ms` | number | Async task poll interval |
| `tools.delegate_task_async.max_sub_agent_depth` | number | Max sub-agent depth |
| `tools.wait_async_task_result.poll_interval_ms` | number | Poll interval for wait tool |
| `tools.process_content_task.max_tool_loop_turns` | number | Loop cap in content task |
| `tools.process_connector_tool.max_tool_loop_turns` | number | Loop cap in connector task |
| `tools.access_connector.max_output_chars` | number | Connector output truncation limit |
| `tools.execute_script.sandbox_mode` | boolean | Enable script sandbox mode |
| `tools.execute_script.script_timeout_ms` | number | Script timeout |
| `tools.execute_script.sandbox_provider.default` | enum | `docker` / `bubblewrap` / `firejail` |
| `tools.execute_script.sandbox_provider.docker.docker_container_scope` | enum | `global` / `user` |
| `tools.execute_script.sandbox_provider.docker.docker_container_name` | string | Docker sandbox container base name |
| `tools.execute_script.sandbox_provider.docker.docker_image` | string | Docker image for sandbox |

### 3.5 Connector Presets

#### Database preset (`tools.database_connect_connector.connectors.<name>`)

| Key | Type | Description |
|---|---|---|
| `database_type` | enum | `mysql` / `postgres` / `sqlite` |
| `host` | string | DB host (mysql/postgres) |
| `port` | number | DB port |
| `username` | string | DB username |
| `password` | string | DB password (recommend `${VAR_NAME}`) |
| `database` | string | DB name (mysql/postgres) |
| `file_path` | string(path) | SQLite file path |

#### Terminal preset (`tools.terminal_connect_connector.connectors.<name>`)

| Key | Type | Description |
|---|---|---|
| `terminal_type` | enum | `ssh` |
| `host` | string | SSH host |
| `port` | number | SSH port |
| `username` | string | SSH username |
| `password` | string | SSH password (recommend `${VAR_NAME}`) |

#### Email preset (`tools.email_connect_connector.connectors.<name>`)

| Key | Type | Description |
|---|---|---|
| `smtp_host` | string | SMTP server |
| `smtp_port` | number/string | SMTP port |
| `imap_host` | string | IMAP server |
| `imap_port` | number/string | IMAP port |
| `username` | string | Email account |
| `password` | string | Auth password/code |
| `from_email` | string | Default sender |
| `to_email` | string | Default recipient |

### 3.6 Providers (`providers.<alias>`)

| Key | Type | Description |
|---|---|---|
| `enabled` | boolean | Enable this provider |
| `used_for_conversation` | boolean | Can be used in chat |
| `api_key` | string | API key (`${VAR_NAME}` supported) |
| `base_url` | string(url) | Model API base URL |
| `model` | string | Model name |
| `format` | enum | `openai_compatible` / `dashscope` |
| `reasoning_effort` | string | Optional (if supported) |
| `temperature` | number | Sampling temperature |
| `max_tokens` | number | Max output tokens |
| `preserve_thinking` | boolean | Optional (if supported) |
| `thinking_budget` | number | Optional (if supported) |
| `description` | string | Provider description |
| `multimodal_generation.support_understanding` | boolean | Multi-modal understanding support |
| `multimodal_generation.support_generation.enabled` | boolean | Multi-modal generation enabled |
| `multimodal_generation.support_generation.support_scope` | string[] | e.g. `["image"]` |

### 3.7 MCP Servers (`mcp_servers.<name>`)

| Key | Type | Description |
|---|---|---|
| `type` | enum | `sse` / `streamableHttp` |
| `description` | string | Service description |
| `isActive` | boolean | Enable this MCP service |
| `name` | string | Display name |
| `baseUrl` | string(url) | MCP endpoint |
| `headers` | object | Request headers (`${VAR_NAME}` supported) |

### 3.8 Super Admin

| Key | Type | Description |
|---|---|---|
| `super_admin.user_id` | string | Super admin user id |
| `super_admin.connect_code` | string | Super admin connect code |

---

## 4) User Config (`workspace/<userId>/config.json`)

User config can override global values.

| Section | Description |
|---|---|
| `default_provider` | User default provider |
| `attachments` | User attachment policy override |
| `tools` | User tool enable/options override |
| `providers` | User provider override |
| `mcp_servers` | User MCP override |
| `streaming` | User streaming behavior |

---

## 5) Placeholder Resolution (`${VAR_NAME}`)

| Source | Path |
|---|---|
| User params | `workspace/<userId>/config-params.json` |
| System params | `workspace/config-params.json` |
| Environment | process env |

Recommended format:

```json
{ "api_key": "${DASHSCOPE_API_KEY}" }
```

---

## 6) Migration Notes

| Item | Recommendation |
|---|---|
| Key naming | Use snake_case (latest example format) |
| Legacy keys | Migrate camelCase gradually |
| After changes | Restart with `./start.sh` |

