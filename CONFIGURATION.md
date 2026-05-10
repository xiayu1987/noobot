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
| `tools.read_file.enabled` | boolean | Enable file read tool |
| `tools.write_file.enabled` | boolean | Enable file write tool |
| `tools.list_skills.enabled` | boolean | Enable skill listing tool |
| `tools.set_skill_task.enabled` | boolean | Enable skill task tool |
| `tools.call_service.enabled` | boolean | Enable external service call tool |
| `tools.call_mcp_task.enabled` | boolean | Enable MCP task tool |
| `tools.delegate_task_async.enabled` | boolean | Enable async delegation tool |
| `tools.delegate_task_async.wait_timeout_ms` | number | Async task wait timeout |
| `tools.delegate_task_async.poll_interval_ms` | number | Async task poll interval |
| `tools.delegate_task_async.max_sub_agent_depth` | number | Max sub-agent depth |
| `tools.wait_async_task_result.enabled` | boolean | Enable wait async result tool |
| `tools.wait_async_task_result.poll_interval_ms` | number | Poll interval for wait tool |
| `tools.plan_multi_task_collaboration.enabled` | boolean | Enable task planning tool |
| `tools.switch_model.enabled` | boolean | Enable model switch tool |
| `tools.user_interaction.enabled` | boolean | Enable user interaction tool |
| `tools.web_to_data.enabled` | boolean | Enable web content extraction tool |
| `tools.web_to_data.switch_web_mode` | string | Web extraction mode (e.g. `browser_simulate`) |
| `tools.doc_to_data.enabled` | boolean | Enable document parsing tool |
| `tools.process_content_task.enabled` | boolean | Enable content processing tool |
| `tools.process_content_task.max_tool_loop_turns` | number | Loop cap in content task |
| `tools.execute_script.enabled` | boolean | Enable script execution tool |
| `tools.execute_script.sandbox_mode` | boolean | Enable script sandbox mode |
| `tools.execute_script.script_timeout_ms` | number | Script timeout |
| `tools.execute_script.sandbox_provider.default` | enum | `docker` / `bubblewrap` / `firejail` |
| `tools.execute_script.sandbox_provider.docker.docker_container_scope` | enum | `global` / `user` |
| `tools.execute_script.sandbox_provider.docker.docker_container_name` | string | Docker sandbox container base name |
| `tools.execute_script.sandbox_provider.docker.docker_image` | string | Docker image for sandbox |
| `tools.execute_script.sandbox_provider.docker.docker_mounts` | object[] | Extra host->container mount list (optional) |
| `tools.execute_script.sandbox_provider.docker.docker_mounts[].source` | string(path) | Host path to mount |
| `tools.execute_script.sandbox_provider.docker.docker_mounts[].target` | string(path) | Container target path (auto-normalized to `/xxx`) |
| `tools.execute_script.sandbox_provider.docker.docker_mounts[].description` | string | Human-readable mapping note (optional) |
| `tools.process_connector_tool.enabled` | boolean | Enable connector processing tool |
| `tools.process_connector_tool.max_tool_loop_turns` | number | Loop cap in connector task |
| `tools.access_connector.enabled` | boolean | Enable connector access tool |
| `tools.access_connector.max_output_chars` | number | Connector output truncation limit |
| `tools.database_connect_connector.enabled` | boolean | Enable database connector tool |
| `tools.terminal_connect_connector.enabled` | boolean | Enable terminal connector tool |
| `tools.inspect_connectors.enabled` | boolean | Enable connector inspection tool |
| `tools.multimodal_generate.enabled` | boolean | Enable multimodal generation tool |
| `tools.email_connect_connector.enabled` | boolean | Enable email connector tool |

Notes:
- If `docker_mounts` is missing or empty, no extra mount is added.
- A mount entry is applied only when both `source` and `target` are non-empty.
- Current defaults in repo:
  - `service/config/global.config.json`: mounts this project to `/project`
  - `service/config/global.config.example.json`: no default project mount

### 3.5 Scenarios

| Key | Type | Description |
|---|---|---|
| `scenarios.default` | string | Default scenario key (used when request does not set `config.scenario`) |
| `scenarios.definitions.<name>.name` | string | Display name used by frontend scenario buttons |
| `scenarios.definitions.<name>.model` | string | Runtime model alias/name for this scenario (applied when request does not set `runtimeModel`) |
| `scenarios.definitions.<name>.tools` | string[] | Allowed tool names for this scenario |
| `scenarios.definitions.<name>.context` | string[] | Allowed context sections (`system_runtime`, `base_prompt`, etc.) |

Current defaults in repo:
- `full` (default): tools/context are empty arrays, meaning no extra restriction
- `programming`: model=`"qwen3_6_plus_2026_04_02"`, tools=`["execute_script"]`, context=`["system_runtime","base_prompt"]`

### 3.6 Connector Presets

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

### 3.7 Providers (`providers.<alias>`)

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

### 3.8 MCP Servers (`mcp_servers.<name>`)

| Key | Type | Description |
|---|---|---|
| `type` | enum | `sse` / `streamableHttp` |
| `description` | string | Service description |
| `isActive` | boolean | Enable this MCP service |
| `name` | string | Display name |
| `baseUrl` | string(url) | MCP endpoint |
| `headers` | object | Request headers (`${VAR_NAME}` supported) |

### 3.9 Super Admin

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
| `scenarios` | User scenario definitions/default override |
| `providers` | User provider override |
| `services` | User external service definitions (see §4.1) |
| `mcp_servers` | User MCP override |
| `preferences` | User preferences (e.g. `language`) |
| `streaming` | User streaming behavior |

### 4.1 External Services (`services.<name>`)

User-level external service definitions for `call_service` tool.

| Key | Type | Description |
|---|---|---|
| `services.<name>.enabled` | boolean | Enable this service |
| `services.<name>.api_key` | string | Service API key (optional) |
| `services.<name>.handler` | string | Handler name |
| `services.<name>.endpoints.<epName>.description` | string | Endpoint description |
| `services.<name>.endpoints.<epName>.url` | string(url) | Endpoint URL (`${VAR_NAME}` supported) |
| `services.<name>.endpoints.<epName>.query_string_format` | string | Query string template |
| `services.<name>.endpoints.<epName>.body_format` | string | Request body template |
| `services.<name>.endpoints.<epName>.custom_param_format` | string | Custom param template |

Current defaults in repo:
- `web_search_service`: search endpoint using SearX instance
- `weather_service`: weather query via `wttr.in`

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
| Legacy keys | Not supported. Use snake_case keys only. |
| After changes | Restart with `./start.sh` |
