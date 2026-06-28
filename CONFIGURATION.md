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
| `run_timeout_ms` | number | Single run timeout (ms), e.g. `7200000` |

### 3.2 Session

| Key | Type | Description |
|---|---|---|
| `session.recent_message_limit` | number | Number of recent messages in context |
| `context.main_model_recent_window` | boolean | Whether `agent.main` uses recent-window clipping |
| `context.main_model_recent_limit` | number | Recent-window size for `agent.main` (effective when enabled) |
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
| `tools.doc_to_data.parse_engine` | string | Document parsing engine (default `libreoffice`) |
| `tools.process_content_task.enabled` | boolean | Enable content processing tool |
| `tools.process_content_task.max_tool_loop_turns` | number | Loop cap in content task |
| `tools.execute_script.enabled` | boolean | Enable script execution tool |
| `tools.execute_script.sandbox_mode` | boolean | Enable script sandbox mode |
| `tools.execute_script.script_timeout_ms` | number | Script timeout |
| `tools.execute_script.sandbox_provider.default` | enum | `docker` / `bubblewrap` / `firejail` |
| `tools.execute_script.sandbox_provider.docker.docker_container_scope` | enum | `global` / `user` |
| `tools.execute_script.sandbox_provider.docker.docker_container_name` | string | Docker sandbox container base name |
| `tools.execute_script.sandbox_provider.docker.docker_image` | string | Docker image for sandbox |
| `tools.execute_script.sandbox_provider.docker.docker_lock_wait_timeout_ms` | number | Max queue wait time (ms) when concurrent calls share one Docker container name |
| `tools.execute_script.sandbox_provider.docker.docker_mounts` | object[] | Extra host->container mount list (optional) |
| `tools.execute_script.sandbox_provider.docker.docker_mounts[].source` | string(path) | Host path to mount |
| `tools.execute_script.sandbox_provider.docker.docker_mounts[].target` | string(path) | Container target path (auto-normalized to `/xxx`) |
| `tools.execute_script.sandbox_provider.docker.docker_mounts[].description` | string | Human-readable mapping note (optional) |
| `tools.process_connector_tool.enabled` | boolean | Enable connector processing tool |
| `tools.process_connector_tool.max_tool_loop_turns` | number | Loop cap in connector task |
| `tools.access_connector.enabled` | boolean | Enable connector access tool |
| `tools.access_connector.command_file.enabled` | boolean | Enable `command_file_path` input for access_connector |
| `tools.access_connector.command_file.max_bytes` | number | Max readable bytes for command file |
| `tools.access_connector.command_file.allowed_extensions` | string[] | Allowlisted command file extensions |
| `tools.access_connector.command_file.allowed_roots` | string(path)[] | Allowlisted root paths for command files (default workspace root when empty) |
| `tools.max_output_chars` | number | Unified tool output cleaning/truncation length limit |
| `tools.database_connect_connector.enabled` | boolean | Enable database connector tool |
| `tools.terminal_connect_connector.enabled` | boolean | Enable terminal connector tool |
| `tools.inspect_connectors.enabled` | boolean | Enable connector inspection tool |
| `tools.multimodal_generate.enabled` | boolean | Enable multimodal generation tool |
| `tools.task_summary.enabled` | boolean | Enable task summary tool |
| `tools.task_summary.phase_summary_loop_turns` | number | Number of turns threshold to trigger phase summary |
| `tools.request_help.enabled` | boolean | Enable request-help tool |
| `tools.request_help.help_services` | string[]/object[] | Help service list (empty by default; use the `web_search` tool for web search) |
| `tools.request_help.help_model` | string | Help model alias/name (empty = current/default model logic) |
| `tools.request_help.help_prompt_loop_turns` | number | Tool loop turns threshold for system help prompt (default 50) |
| `tools.request_help.tool_failure_help_count` | number | Consecutive tool failures threshold for user help prompt (default 3) |
| `tools.email_connect_connector.enabled` | boolean | Enable email connector tool |

Large-context length defaults:
- Phase-summary character threshold: 225000
- Semantic-transfer direct threshold: 30000 chars
- Semantic-transfer tool-result inline threshold: 30000 chars
- Semantic-transfer tool-input overflow threshold: 30000 chars

Length thresholds are centralized in `@noobot/shared/length-thresholds` (`shared/length-thresholds.mjs`). Update that package export when changing character/byte/string-size limits.

Notes:
- If `docker_mounts` is missing or empty, no extra mount is added.
- A mount entry is applied only when both `source` and `target` are non-empty.
- Current defaults in repo:
  - `service/config/global.config.json`: mounts this project to `/project`
  - `service/config/global.config.example.json`: no default project mount

### 3.5 Scenarios

| Key | Type | Description |
|---|---|---|
| `scenarios.default` | string | Default scenario key (only built-in `full` / `programming`; used when request does not set `config.scenario`) |
| `scenarios.definitions.programming.model` | string | Default runtime model alias/name for the programming scenario (applied when request does not set `runtimeModel`) |

Scenario definitions are now system built-ins with two fixed scenarios:
- `full` (all-purpose, default): tools/context/services/mcp_servers are `["*"]`, meaning unrestricted by scenario.
- `programming`: fixed code-task policy with required coding tools, code context sections, and the `web_search` tool; configuration may override only `model`.

Other scenario fields in global/user config (`name`, `description`, `tools`, `context`, `services`, `mcp_servers`) and custom scenario definitions are ignored to protect built-in behavior.

### 3.5.1 Plugins

| Key | Type | Description |
|---|---|---|
| `plugins.<name>.enabled` | boolean | Plugin global switch. When `false`, plugin is hidden in frontend and disabled at runtime. |
| `plugins.<name>.mode` | enum | Default runtime mode for this plugin. Currently `on` / `off` (`off` means enabled but not active by default). |
| `plugins.harness.stepModels.<purpose>` | string | Harness step-specific model alias (`planning` / `guidance` / `acceptance` / `default`). |
| `plugins.harness.contextWindowRecentMessageLimit` | number | Harness history block recent-window limit used by unified clipping entry. |
| `plugins.harness.incrementalRecentMessageLimit` | number | Harness incremental block recent-window limit used by unified clipping entry. |

Current plugin defaults in repo:
- `plugins.harness.enabled = true`
- `plugins.harness.mode = "off"`
- `plugins.harness.stepModels = { planning, guidance, acceptance, default }` (all default to `"qwen3_6_plus"` in current example)

Effective defaults when recent-window limits are not configured:
- `plugins.harness.contextWindowRecentMessageLimit = 20`
- `plugins.harness.incrementalRecentMessageLimit = 20` (fallback to history limit when omitted)

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
| `providers.<alias>.enabled` | boolean | Enable this provider |
| `providers.<alias>.used_for_conversation` | boolean | Can be used in chat |
| `providers.<alias>.api_key` | string | API key (`${VAR_NAME}` supported) |
| `providers.<alias>.base_url` | string(url) | Model API base URL |
| `providers.<alias>.model` | string | Model name |
| `providers.<alias>.format` | enum | `openai_compatible` / `dashscope` |
| `providers.<alias>.reasoning_effort` | string | Optional (if supported) |
| `providers.<alias>.enable_thinking` | boolean | Optional thinking switch (commonly for dashscope-compatible models) |
| `providers.<alias>.temperature` | number | Sampling temperature |
| `providers.<alias>.max_tokens` | number | Max output tokens |
| `providers.<alias>.top_p` | number | Optional nucleus sampling parameter |
| `providers.<alias>.frequency_penalty` | number | Optional frequency penalty |
| `providers.<alias>.presence_penalty` | number | Optional presence penalty |
| `providers.<alias>.preserve_thinking` | boolean | Optional (if supported) |
| `providers.<alias>.thinking_budget` | number | Optional (if supported) |
| `providers.<alias>.description` | string | Provider description |
| `providers.<alias>.multimodal_generation.support_understanding` | boolean | Multi-modal understanding support |
| `providers.<alias>.multimodal_generation.support_generation.enabled` | boolean | Multi-modal generation enabled |
| `providers.<alias>.multimodal_generation.support_generation.support_scope` | string[] | e.g. `["image"]` |

### 3.8 MCP Servers (`mcp_servers.<name>`)

| Key | Type | Description |
|---|---|---|
| `mcp_servers.<name>.type` | enum | `sse` / `streamableHttp` |
| `mcp_servers.<name>.description` | string | Service description |
| `mcp_servers.<name>.prompt` | string | MCP prompt text (injected into system prompt) |
| `mcp_servers.<name>.isActive` | boolean | Enable this MCP service |
| `mcp_servers.<name>.name` | string | Display name |
| `mcp_servers.<name>.baseUrl` | string(url) | MCP endpoint |
| `mcp_servers.<name>.headers` | object | Request headers (`${VAR_NAME}` supported) |

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
| `scenarios` | User scenario selection / programming model override (only `default` and `definitions.programming.model`) |
| `plugins` | User plugin default/enable override |
| `providers` | User provider override |
| `services` | User external service definitions (see §4.1) |
| `mcp_servers` | User MCP override |
| `preferences` | User preferences (e.g. `language`) |
| `preferences.language` | string | UI/interaction language, e.g. `zh-CN` / `en-US` |
| `streaming` | User streaming behavior |

### 4.1 External Services (`services.<name>`)

User-level external service definitions for `call_service` tool.

| Key | Type | Description |
|---|---|---|
| `services.<name>.enabled` | boolean | Enable this service |
| `services.<name>.api_key` | string | Service API key (optional) |
| `services.<name>.handler` | string | Handler name |
| `services.<name>.prompt` | string | Service-level prompt text (injected into system prompt) |
| `services.<name>.endpoints.<epName>.description` | string | Endpoint description |
| `services.<name>.endpoints.<epName>.prompt` | string | Endpoint-level prompt text (injected into system prompt) |
| `services.<name>.endpoints.<epName>.url` | string(url) | Endpoint URL (`${VAR_NAME}` supported) |
| `services.<name>.endpoints.<epName>.query_string_format` | string | Query string template |
| `services.<name>.endpoints.<epName>.body_format` | string | Request body template |
| `services.<name>.endpoints.<epName>.custom_param_format` | string | Custom param template |

Current defaults in repo:
- `weather_service`: weather query via `wttr.in`

Web search is provided by the `web_search` tool, not by an external service.

### 4.2 Plugins (`plugins.<name>`)

| Key | Type | Description |
|---|---|---|
| `plugins.<name>.enabled` | boolean | User-level plugin switch override. |
| `plugins.<name>.mode` | enum | User-level default mode override (`on` / `off`). |

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
