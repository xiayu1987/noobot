# Configuration

[中文](./CONFIGURATION.zh-CN.md) | English

This document describes the latest Noobot configuration structure based on:

- `service/config/global.config.example.json`
- `user-template/default-user/config.example.json`
- `service/.env.example`

---

## 1) Config Files

### Global

- `service/config/global.config.json`
- Example: `service/config/global.config.example.json`

### User

- Template: `user-template/default-user/config.json`
- Runtime: `workspace/<userId>/config.json`

### Param Files (for `${VAR_NAME}`)

- System: `workspace/config-params.json`
- User: `workspace/<userId>/config-params.json`

These values are used to resolve placeholders in config files.

### Env

- `service/.env` (example: `service/.env.example`)
- Current required key:
  - `PORT` (default example: `10061`)

---

## 2) Global Config (`global.config.json`)

## 2.1 Core

- `workspace_root`
- `workspace_template_path`
- `default_provider`
- `memory_max_items`
- `max_tool_loop_turns`
- `streaming`

## 2.2 Session

`session`:

- `recent_message_limit`
- `use_last_running_task_range`
- `use_last_completed_task_range`

## 2.3 Attachments

`attachments`:

- `max_file_count`
- `max_file_size_bytes`
- `max_total_size_bytes`
- `allowed_extensions`
- `attachment_models.audio`
- `attachment_models.video`
- `attachment_models.image`

## 2.4 Tools

`tools.<tool_name>.enabled` is supported for all tools.  
Current example includes:

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

### Tool-specific key examples

- `delegate_task_async.wait_timeout_ms`
- `delegate_task_async.poll_interval_ms`
- `delegate_task_async.max_sub_agent_depth`
- `wait_async_task_result.poll_interval_ms`
- `process_content_task.max_tool_loop_turns`
- `process_connector_tool.max_tool_loop_turns`
- `access_connector.max_output_chars`
- `execute_script.sandbox_mode`
- `execute_script.script_timeout_ms`
- `execute_script.sandbox_provider.default` (`docker` / `bubblewrap` / `firejail`)
- `execute_script.sandbox_provider.docker.*`

## 2.5 Connector Presets

### Database

`tools.database_connect_connector.connectors.<name>`:

- `database_type` (`mysql` / `postgres` / `sqlite`)
- `host`
- `port`
- `username`
- `password` (recommended `${VAR_NAME}`)
- `database` (for mysql/postgres)
- `file_path` (for sqlite)

### Terminal

`tools.terminal_connect_connector.connectors.<name>`:

- `terminal_type` (`ssh`)
- `host`
- `port`
- `username`
- `password` (recommended `${VAR_NAME}`)

### Email

`tools.email_connect_connector.connectors.<name>`:

- `smtp_host`
- `smtp_port`
- `imap_host`
- `imap_port`
- `username`
- `password`
- `from_email`
- `to_email`

## 2.6 Providers

`providers.<alias>` keys (example):

- `enabled`
- `used_for_conversation`
- `api_key`
- `base_url`
- `model`
- `format` (`openai_compatible` / `dashscope`)
- `reasoning_effort` (if supported)
- `temperature`
- `max_tokens`
- `preserve_thinking` (if supported)
- `thinking_budget` (if supported)
- `description`
- `multimodal_generation.support_understanding`
- `multimodal_generation.support_generation.enabled`
- `multimodal_generation.support_generation.support_scope`

Current example aliases:

- `gemini_3_flash`
- `nano_banana`
- `qwen3_6_plus_2026_04_02`
- `qwen3_5_omni_plus`

## 2.7 MCP Servers

`mcp_servers.<name>`:

- `type` (`sse` / `streamableHttp`)
- `description`
- `isActive`
- `name`
- `baseUrl`
- `headers` (supports `${VAR_NAME}`)

## 2.8 Super Admin

`super_admin`:

- `user_id`
- `connect_code`

---

## 3) User Config (`workspace/<userId>/config.json`)

User config can override global behavior.

Main sections:

- `default_provider`
- `attachments` (same structure as global)
- `tools` (same structure as global)
- `providers` (same structure as global)
- `mcp_servers` (same structure as global)
- `streaming`
- `super_admin` (optional for user-side overrides)

---

## 4) Placeholder Resolution

Recommended style:

```json
{
  "api_key": "${DASHSCOPE_API_KEY}"
}
```

Typical value sources:

1. `workspace/<userId>/config-params.json`
2. `workspace/config-params.json`
3. environment variables

(Exact runtime precedence depends on implementation path.)

---

## 5) Migration Notes

- Use snake_case keys shown in latest `*.example.json`.
- If old camelCase keys exist, align them to snake_case gradually.
- After changing config, restart service (`./start.sh` recommended).

