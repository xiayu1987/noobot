# Configuration

[中文](./CONFIGURATION.zh-CN.md) | English

Based on latest examples:

- `service/config/global.config.example.json`
- `user-template/default-user/config.example.json`
- `service/.env.example`

---

## 1) File Locations

| Scope               | Path                                        | Description                                |
| ------------------- | ------------------------------------------- | ------------------------------------------ |
| Global config       | `service/config/global.config.json`         | System-wide runtime config                 |
| Global example      | `service/config/global.config.example.json` | Latest reference template                  |
| User template       | `user-template/default-user/config.json`    | Default user config template               |
| User runtime config | `workspace/<userId>/config.json`            | Per-user effective config                  |
| System params       | `workspace/config-params.json`              | Placeholder values for all users           |
| User params         | `workspace/<userId>/config-params.json`     | Placeholder values for one user            |
| Env file            | `service/.env`                              | Backend env vars (example: `.env.example`) |

---

## 2) Environment Variables

| Key                                           | Type         | Example                     | Description                                                                                                                                        |
| --------------------------------------------- | ------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                        | number       | `10061`                     | Backend listen port                                                                                                                                |
| `NOOBOT_SESSION_LOG_ROOT`                     | string(path) | `../workspace/session-logs` | Backend directory for session log files written by the log WebSocket. Defaults to `../workspace/session-logs` relative to the backend process cwd. |
| `NOOBOT_SESSION_LOG_RETENTION_MS`             | number       | `604800000`                 | Session log retention time in milliseconds. Defaults to 7 days. Expired session log directories are removed by the backend cleanup task.           |
| `NOOBOT_SESSION_LOG_CLEANUP_INTERVAL_MS`      | number       | `3600000`                   | Backend cleanup interval for expired session logs.                                                                                                 |
| `NOOBOT_RUNTIME_EVENT_STATE_LOG`              | boolean      | `true`                      | Whether runtime-events records state session logs.                                                                                                 |
| `NOOBOT_RUNTIME_EVENT_MESSAGE_LOG`            | boolean      | `true`                      | Whether runtime-events records message session logs.                                                                                               |
| `NOOBOT_RUNTIME_EVENT_INTERACTION_LOG`        | boolean      | `true`                      | Whether runtime-events records interaction session logs.                                                                                           |
| `NOOBOT_RUNTIME_EVENT_TRANSPORT_LOG`          | boolean      | `true`                      | Whether runtime-events records transport session logs.                                                                                             |
| `NOOBOT_RUNTIME_EVENT_AGENT_PROXY_LOG`        | boolean      | `true`                      | Whether runtime-events records agent-proxy session logs.                                                                                           |
| `NOOBOT_RUNTIME_EVENT_SYSTEM_LOG`             | boolean      | `true`                      | Whether runtime-events records system session logs.                                                                                                |
| `NOOBOT_RUNTIME_EVENT_STATE_MACHINE_DEBUG`    | boolean      | `false`                     | Whether runtime-events records state-machine debug events.                                                                                         |
| `NOOBOT_RUNTIME_EVENT_RESEND_DEBUG`           | boolean      | `false`                     | Whether runtime-events records resend debug events.                                                                                                |
| `NOOBOT_RUNTIME_EVENT_STOP_DEBUG`             | boolean      | `false`                     | Whether runtime-events records stop debug events.                                                                                                  |
| `NOOBOT_RUNTIME_EVENT_SESSION_LOG_WS_DEBUG`   | boolean      | `false`                     | Whether runtime-events records session log WebSocket debug events.                                                                                 |
| `NOOBOT_RUNTIME_EVENT_CONTEXT_IDENTITY_DEBUG` | boolean      | `true`                      | Whether runtime-events records persisted-message identity, Context assembly, model projection, and stopped-snapshot diagnostics.                   |

Session log WebSocket:

- Endpoint: `/logs/ws` on the backend, usually reached by the frontend through `/api/logs/ws` and by agent-proxy through the backend upstream.
- Auth: reuses the existing API key WebSocket authentication.
- Storage: backend writes one directory per `sessionId`, and one JSONL file per category (`state`, `message`, `interaction`, `transport`, `agent-proxy`, `system`); debug logs are further split by `data.debugType` into `debug-<debugType>.jsonl`, or `debug.jsonl` when no explicit `debugType` is present.
- Main fields: `source`, `category`, `event`, `sessionId`, optional `dialogProcessId` / `turnScopeId`, and compact `data` payloads for state-machine, message-flow, frontend/backend interaction, and agent-proxy events.
- Control: frontend and agent-proxy only send events through the log WebSocket. Runtime-events is the single control point that decides whether to record by the specific business-type switches in `runtime-events-config.js`.
- Internal session log controls are grouped as `sessionLogControls.log.*` and `sessionLogControls.debug.*`. Flat control fields are not part of the protocol.

---

## 3) Global Config (`global.config.json`)

### 3.1 Core

| Key                       | Type         | Description                             |
| ------------------------- | ------------ | --------------------------------------- |
| `workspace_root`          | string(path) | Workspace root directory                |
| `workspace_template_path` | string(path) | Default user template path              |
| `default_provider`        | string       | Default model provider alias            |
| `memory_max_items`        | number       | Short-memory item limit                 |
| `max_tool_loop_turns`     | number       | Max tool loop turns per request         |
| `streaming`               | boolean      | Enable SSE streaming output             |
| `run_timeout_ms`          | number       | Single run timeout (ms), e.g. `7200000` |

### 3.2 Session

Model history is fixed by the agent runtime: it keeps the latest 5 `dialogProcessId/dialogId` rounds. There is no session history-window configuration.

### 3.3 Attachments

| Key                                | Type     | Description              |
| ---------------------------------- | -------- | ------------------------ |
| `attachments.max_file_count`       | number   | Max files per request    |
| `attachments.max_file_size_bytes`  | number   | Max size per file        |
| `attachments.max_total_size_bytes` | number   | Max total upload size    |
| `attachments.allowed_extensions`   | string[] | Allowed suffix whitelist |

#### Multimodal Defaults

| Key                                          | Type   | Description                                 |
| -------------------------------------------- | ------ | ------------------------------------------- |
| `multimodal.parsing.default_models.audio`    | string | Default provider alias for audio parsing    |
| `multimodal.parsing.default_models.video`    | string | Default provider alias for video parsing    |
| `multimodal.parsing.default_models.image`    | string | Default provider alias for image parsing    |
| `multimodal.parsing.default_models.document` | string | Default provider alias for document parsing |
| `multimodal.generation.default_models.image` | string | Default provider alias for image generation |

Every referenced provider must explicitly declare the corresponding capability. A parse request containing modalities mapped to different defaults must provide `model_name` for one model that supports all of them.

### 3.4 Tools

> All tools support: `tools.<tool_name>.enabled`.

| Key                                                         | Type         | Description                                                                                                 |
| ----------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `tools.read_file.enabled`                                   | boolean      | Enable file read tool                                                                                       |
| `tools.write_file.enabled`                                  | boolean      | Enable file write tool                                                                                      |
| `tools.list_skills.enabled`                                 | boolean      | Enable skill listing tool                                                                                   |
| `tools.call_service.enabled`                                | boolean      | Enable external service call tool                                                                           |
| `tools.call_mcp_task.enabled`                               | boolean      | Enable MCP task tool                                                                                        |
| `tools.delegate_task_async.enabled`                         | boolean      | Enable async delegation tool                                                                                |
| `tools.delegate_task_async.wait_timeout_ms`                 | number       | Async task wait timeout                                                                                     |
| `tools.delegate_task_async.poll_interval_ms`                | number       | Async task poll interval                                                                                    |
| `tools.delegate_task_async.max_sub_agent_depth`             | number       | Max sub-agent depth                                                                                         |
| `tools.wait_async_task_result.enabled`                      | boolean      | Enable wait async result tool                                                                               |
| `tools.wait_async_task_result.poll_interval_ms`             | number       | Poll interval for wait tool                                                                                 |
| `tools.plan_multi_task_collaboration.enabled`               | boolean      | Enable task planning tool                                                                                   |
| `tools.switch_model.enabled`                                | boolean      | Enable model switch tool                                                                                    |
| `tools.user_interaction.enabled`                            | boolean      | Enable user interaction tool                                                                                |
| `tools.execute_native_script.enabled`                       | boolean      | Enable controlled Playwright, LibreOffice, FFmpeg and FFprobe execution                                     |
| `tools.execute_script.enabled`                              | boolean      | Enable script execution tool                                                                                |
| `tools.execute_script.script_timeout_ms`                    | number       | Script timeout                                                                                              |
| `security.execution_isolation.mode`                         | enum         | `sandbox` isolates programmable workspace compute in Docker; fixed workspace file I/O stays host-controlled |
| `security.execution_isolation.sandbox.provider`             | enum         | Workspace sandbox provider (`docker`)                                                                       |
| `security.execution_isolation.sandbox.scope`                | enum         | Container scope (`user`)                                                                                    |
| `security.execution_isolation.sandbox.container_name`       | string       | Per-user workspace sandbox container base name                                                              |
| `security.execution_isolation.sandbox.image`                | string       | Docker image used by programmable workspace compute                                                         |
| `security.execution_isolation.sandbox.mounts`               | object[]     | Additional explicitly authorized host-to-container mounts                                                   |
| `security.execution_isolation.sandbox.mounts[].source`      | string(path) | Absolute host path; Linux, macOS, Windows drive, and UNC paths are supported                                |
| `security.execution_isolation.sandbox.mounts[].target`      | string(path) | Absolute container path outside the managed `/workspace` tree                                               |
| `security.execution_isolation.sandbox.mounts[].description` | string       | Optional mount description                                                                                  |
| `security.execution_isolation.sandbox.mounts[].read_only`   | boolean      | Mount read-only when `true`; defaults to writable to preserve the existing mount behavior                   |
| `security.execution_isolation.sandbox.lock_wait_timeout_ms` | number       | Queue timeout for calls sharing the same container; minimum `100` ms                                        |
| `tools.execute_native_script.enabled`                       | boolean      | Enable the host-restricted Node.js capability tool (default `true`; global admin configuration only)        |

`execute_native_script` injects controlled Playwright, LibreOffice, FFmpeg/FFprobe, declared-input, and task-output capabilities. Its unique file protocol is `files.input`, `files.readText`, `files.readJson`, `files.writeText`, `files.writeJson`, `output.file`, `output.tempFile`, and `output.directory`. Reads accept `input://`, `output://`, and `temp://` task paths; writes accept only `output://`. Capability wrappers resolve task paths internally. It does not expose imports, shell commands, environment variables, executable selection, or arbitrary host paths. Browser access is limited to loopback HTTP(S). Outputs are persisted through semantic-transfer. This host-restricted mode is intended for trusted local/admin automation; it is not an operating-system security sandbox for hostile code.

Execution isolation is defined by the `@noobot/execution-isolation-protocol` workspace. Extra mounts are global-admin configuration only. Changing their source, target, or read-only state causes the managed Docker container to be recreated before the next script execution. Extra mounts do not widen file-tool authorization and cannot replace `/workspace`.
| `tools.access_connector.enabled` | boolean | Enable connector access tool |
| `tools.max_output_chars` | number | Unified tool output cleaning/truncation length limit |
| `tools.multimodal_generate.enabled` | boolean | Enable multimodal generation tool |
| `tools.task_summary.enabled` | boolean | Enable task summary tool |
| `tools.task_summary.phase_summary_loop_turns` | number | Number of turns threshold to trigger phase summary |
| `tools.request_help.enabled` | boolean | Enable request-help tool |
| `tools.request_help.help_services` | string[]/object[] | Help service list (empty by default; use the `web_search` tool for web search) |
| `tools.request_help.help_model` | string | Help model alias/name (empty = current/default model logic) |
| `tools.request_help.help_prompt_loop_turns` | number | Tool loop turns threshold for system help prompt (default 50) |
| `tools.request_help.tool_failure_help_count` | number | Consecutive tool failures threshold for user help prompt (default 3) |
| `tools.web_search.enabled` | boolean | Enable web search tool |
| `tools.web_search.mode` | enum | Search backend: `responses_api` / `search_engine` |
| `tools.web_search.responses_api.model` | string | Provider alias/name used by Responses API web search |
| `tools.web_search.search_engine.prompt` | string | Prompt injected for search-engine mode |
| `tools.web_search.search_engine.endpoints.search.url` | string(url) | Search endpoint URL (`${VAR_NAME}` supported) |
| `tools.web_search.search_engine.endpoints.search.query_string_format` | string | Search query-string template |
| `tools.web_search.search_engine.endpoints.search.body_format` | string | Search request-body template |
| `tools.web_search.search_engine.endpoints.search.custom_param_format` | string | Description of the custom endpoint parameter |

Large-context length defaults:

- Phase-summary character threshold: 220000
- Semantic-transfer direct threshold: 30000 chars
- Semantic-transfer tool-result inline threshold: 30000 chars
- Semantic-transfer tool-input overflow threshold: 30000 chars

Length thresholds are centralized in `@noobot/shared/length-thresholds` (`shared/length-thresholds.js`). Update that package export when changing character/byte/string-size limits.

Notes:

- If `security.execution_isolation.sandbox.mounts` is missing or empty, no extra mount is added.
- Every configured mount must provide both an absolute host `source` and an absolute container `target`.
- Current defaults in repo:
  - `service/config/global.config.json`: mounts this project to `/project`
  - `service/config/global.config.example.json`: no default project mount

### 3.5 Scenarios

| Key                                       | Type   | Description                                                                                                       |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `scenarios.default`                       | string | Default scenario key (built-in `full` / `programming` / `text`; used when request does not set `config.scenario`) |
| `scenarios.definitions.programming.model` | string | Default runtime model alias/name for the programming scenario (applied when request does not set `runtimeModel`)  |
| `scenarios.definitions.text.model`        | string | Default runtime model alias/name for the text scenario (applied when request does not set `runtimeModel`)         |

Scenario definitions are system built-ins with three fixed scenarios:

- `full` (all-purpose, default): tools/context/services/mcp_servers are `["*"]`, meaning unrestricted by scenario.
- `programming`: fixed code-task policy with required coding tools, code context sections, and the `web_search` tool; configuration may override only `model`.
- `text`: fixed text-processing policy and tool/context selection; configuration may override only `model`.

Other scenario fields in global/user config (`name`, `description`, `tools`, `context`, `services`, `mcp_servers`) and custom scenario definitions are ignored to protect built-in behavior.

### 3.5.1 Plugins

| Key                                      | Type    | Description                                                                                                   |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `plugins.<name>.enabled`                 | boolean | Plugin global switch. When `false`, plugin is hidden in frontend and disabled at runtime.                     |
| `plugins.<name>.mode`                    | enum    | Default runtime mode for this plugin. Currently `on` / `off` (`off` means enabled but not active by default). |
| `plugins.harness.stepModels.<purpose>`   | string  | Harness step-specific model alias (`planning` / `guidance` / `acceptance` / `default`).                       |
| `plugins.workflow.semanticModel`         | string  | Model alias/name used for workflow semantic processing.                                                       |
| `plugins.workflow.parallelNodeExecution` | boolean | Enable parallel execution for eligible workflow nodes.                                                        |

Current plugin defaults in repo:

- `plugins.harness.enabled = true`
- `plugins.harness.mode = "off"`
- `plugins.harness.stepModels = { planning, guidance, acceptance, default }` (all default to `"GLM_5_1"` in the current example)
- `plugins.workflow.enabled = true`
- `plugins.workflow.mode = "off"`
- `plugins.workflow.semanticModel = "GLM_5_1"`
- `plugins.workflow.parallelNodeExecution = true` in the global example

### 3.6 Providers (`providers.<alias>`)

Copy-ready current model entries are maintained in [`model-protocol/model-library.json`](model-protocol/model-library.json). Runtime capability checks still use only the provider entry copied into the active configuration.

| Key                                                                        | Type        | Description                                                         |
| -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| `providers.<alias>.enabled`                                                | boolean     | Enable this provider                                                |
| `providers.<alias>.used_for_conversation`                                  | boolean     | Can be used in chat                                                 |
| `providers.<alias>.api_key`                                                | string      | API key (`${VAR_NAME}` supported)                                   |
| `providers.<alias>.base_url`                                               | string(url) | Model API base URL                                                  |
| `providers.<alias>.model`                                                  | string      | Model name                                                          |
| `providers.<alias>.format`                                                 | enum        | `openai_compatible` / `dashscope`                                   |
| `providers.<alias>.reasoning_effort`                                       | string      | Optional (if supported)                                             |
| `providers.<alias>.enable_thinking`                                        | boolean     | Optional thinking switch (commonly for dashscope-compatible models) |
| `providers.<alias>.temperature`                                            | number      | Sampling temperature                                                |
| `providers.<alias>.max_tokens`                                             | number      | Max output tokens                                                   |
| `providers.<alias>.top_p`                                                  | number      | Optional nucleus sampling parameter                                 |
| `providers.<alias>.frequency_penalty`                                      | number      | Optional frequency penalty                                          |
| `providers.<alias>.presence_penalty`                                       | number      | Optional presence penalty                                           |
| `providers.<alias>.preserve_thinking`                                      | boolean     | Optional (if supported)                                             |
| `providers.<alias>.thinking_budget`                                        | number      | Optional (if supported)                                             |
| `providers.<alias>.description`                                            | string      | Provider description                                                |
| `providers.<alias>.multimodal_parsing.enabled`                             | boolean     | Multi-modal parsing enabled                                         |
| `providers.<alias>.multimodal_parsing.input_modalities`                    | string[]    | Explicit accepted inputs: `image`, `document`, `audio`, `video`     |
| `providers.<alias>.multimodal_generation.support_generation.enabled`       | boolean     | Multi-modal generation enabled                                      |
| `providers.<alias>.multimodal_generation.support_generation.support_scope` | string[]    | e.g. `["image"]`                                                    |
| `providers.<alias>.multimodal_generation.support_generation.api_type`      | enum        | `openai_responses` / `images_async`; required when generation is on |

### 3.7 MCP Servers (`mcp_servers.<name>`)

| Key                              | Type        | Description                                   |
| -------------------------------- | ----------- | --------------------------------------------- |
| `mcp_servers.<name>.type`        | enum        | `sse` / `streamableHttp`                      |
| `mcp_servers.<name>.description` | string      | Service description                           |
| `mcp_servers.<name>.prompt`      | string      | MCP prompt text (injected into system prompt) |
| `mcp_servers.<name>.isActive`    | boolean     | Enable this MCP service                       |
| `mcp_servers.<name>.name`        | string      | Display name                                  |
| `mcp_servers.<name>.baseUrl`     | string(url) | MCP endpoint                                  |
| `mcp_servers.<name>.headers`     | object      | Request headers (`${VAR_NAME}` supported)     |

### 3.8 Super Admin

| Key                        | Type   | Description              |
| -------------------------- | ------ | ------------------------ |
| `super_admin.user_id`      | string | Super admin user id      |
| `super_admin.connect_code` | string | Super admin connect code |

---

## 4) User Config (`workspace/<userId>/config.json`)

User config can override global values.

| Section                | Description                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `default_provider`     | User default provider                                                                                                                    |
| `attachments`          | User attachment policy override                                                                                                          |
| `tools`                | User tool enable/options override                                                                                                        |
| `scenarios`            | User scenario selection and per-scenario model overrides (only `default`, `definitions.programming.model`, and `definitions.text.model`) |
| `plugins`              | User plugin default/enable override                                                                                                      |
| `providers`            | User provider override                                                                                                                   |
| `services`             | User external service definitions (see §4.1)                                                                                             |
| `mcp_servers`          | User MCP override                                                                                                                        |
| `preferences`          | User preferences (e.g. `language`)                                                                                                       |
| `preferences.language` | string                                                                                                                                   | UI/interaction language, e.g. `zh-CN` / `en-US` |
| `streaming`            | User streaming behavior                                                                                                                  |

### 4.1 External Services (`services.<name>`)

User-level external service definitions for `call_service` tool.

| Key                                                      | Type        | Description                                              |
| -------------------------------------------------------- | ----------- | -------------------------------------------------------- |
| `services.<name>.enabled`                                | boolean     | Enable this service                                      |
| `services.<name>.api_key`                                | string      | Service API key (optional)                               |
| `services.<name>.handler`                                | string      | Handler name                                             |
| `services.<name>.prompt`                                 | string      | Service-level prompt text (injected into system prompt)  |
| `services.<name>.endpoints.<epName>.description`         | string      | Endpoint description                                     |
| `services.<name>.endpoints.<epName>.prompt`              | string      | Endpoint-level prompt text (injected into system prompt) |
| `services.<name>.endpoints.<epName>.url`                 | string(url) | Endpoint URL (`${VAR_NAME}` supported)                   |
| `services.<name>.endpoints.<epName>.query_string_format` | string      | Query string template                                    |
| `services.<name>.endpoints.<epName>.body_format`         | string      | Request body template                                    |
| `services.<name>.endpoints.<epName>.custom_param_format` | string      | Custom param template                                    |

Current defaults in repo:

- `weather_service`: weather query via `wttr.in`

Web search is provided by the `web_search` tool, not by an external service.

### 4.2 Plugins (`plugins.<name>`)

| Key                      | Type    | Description                                      |
| ------------------------ | ------- | ------------------------------------------------ |
| `plugins.<name>.enabled` | boolean | User-level plugin switch override.               |
| `plugins.<name>.mode`    | enum    | User-level default mode override (`on` / `off`). |

---

## 5) Placeholder Resolution (`${VAR_NAME}`)

| Source        | Path                                    |
| ------------- | --------------------------------------- |
| User params   | `workspace/<userId>/config-params.json` |
| System params | `workspace/config-params.json`          |
| Environment   | process env                             |

Recommended format:

```json
{ "api_key": "${DASHSCOPE_API_KEY}" }
```

---

## 6) Migration Notes

| Item          | Recommendation                           |
| ------------- | ---------------------------------------- |
| Key naming    | Use snake_case (latest example format)   |
| Legacy keys   | Not supported. Use snake_case keys only. |
| After changes | Restart with `./start.sh`                |
