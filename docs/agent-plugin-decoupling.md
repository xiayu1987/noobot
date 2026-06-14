# Agent Plugin Decoupling Plan

Last updated: **2026-06-14**

## Goal

Agent core must not depend on concrete plugin identities such as `harness` or `workflow`.

Agent-owned code speaks only in generic plugin slots:

- `agentPlugin`: agent-side plugin slot, registered by `PLUGIN_CAPABILITY.AGENT_REGISTER`
- `botPlugin`: bot/orchestration-side plugin slot, registered by `PLUGIN_CAPABILITY.BOT_REGISTER`

No `extension` compatibility layer is required for agent-owned runtime/config/protocol names. Concrete plugin packages may keep their own package names and manifest keys, but agent core discovers them by manifest/capability and must not hardcode those keys in agent-owned branching, defaults, protocols, or persisted schema.

## Boundary rule

### Allowed in agent main path

- Capability-based discovery:
  - `PLUGIN_CAPABILITY.AGENT_REGISTER`
  - `PLUGIN_CAPABILITY.BOT_REGISTER`
- Generic runtime/config slots:
  - `plugins.agentPlugin`
  - `plugins.botPlugin`
  - `runtime.agentPlugin`
  - `runtime.botPlugin`
- Plugin manifest/capability resolution that treats concrete plugin keys as external data.

### Not allowed in agent main path

- Defaulting an agent-owned slot to a concrete plugin key.
- New business logic that branches on concrete plugin names.
- New compatibility aliases for old generic names.
- Concrete-plugin protocol mirrors.
- Legacy relay labels as canonical or compatibility behavior in agent code.

## Guard script

Run from repo root:

```bash
npm run check:agent-plugin-decoupling
```

Or from the agent workspace:

```bash
npm -w agent run check:plugin-decoupling
```

The script is:

```text
scripts/check-agent-plugin-decoupling.mjs
```

It scans `agent/src/system-core` and fails if concrete plugin terms appear. There is no longer any allowlisted concrete-plugin coupling in agent core.

## Completed changes

- [x] Introduced generic session plugin runtime fields:
  - `agentPluginKey`
  - `agentPluginSelectors`
  - `botPluginKey`
  - `botPluginSelectors`
- [x] Removed generic runtime/config compatibility aliases from the agent path.
- [x] Changed default fallback plugin keys from concrete plugin names to generic slots:
  - `agentPlugin`
  - `botPlugin`
- [x] Runtime event payload now has only generic primary fields:
  - `agentPlugin`
  - `botPlugin`
- [x] Added and tightened `check-agent-plugin-decoupling`; the allowlist is now empty.
- [x] Simplified central plugin constants module:
  - `agent/src/system-core/plugin/plugin-constants.js`
  - It now contains only generic plugin slot/runtime/registration constants.
- [x] Removed concrete plugin terms from the plugin runtime provider, preparer, runner, detached sub-session runtime state, model headers, model-message helper, and relay helper.
- [x] Added canonical plugin model headers only:
  - `agent/src/system-core/model/headers/plugin-headers.js`
  - `X-Plugin-Flow`
  - `X-Plugin-Purpose`
  - `X-Plugin-Domain`
  - `X-Plugin-Session-Id`
- [x] Capability mini-runner now defaults to `headerNamespace: "plugin"` and emits `X-Plugin-*` for the canonical path.
- [x] Added canonical plugin relay recognition only:
  - `[Relay from plugin/<purpose>]`
  - `[Relay from agent plugin/<purpose>]`
- [x] New relay message types are normalized as `plugin_relay:<purpose>`.
- [x] Renamed plugin runtime plumbing away from `Extension` file/class/function names:
  - `RunConfigPluginPreparer`
  - `session-plugin-runtime-adapter.js`
  - `session-plugin-runtime-provider.js`
- [x] Renamed the built-in threshold namespace used by the bot/orchestration plugin from `workflow` to `botPlugin`.
- [x] Migrated persisted message schema names in agent core:
  - `pluginMessage`
  - `pluginMeta`
- [x] Removed `workflowMessage` / `workflowMeta` reads/writes from agent core.
- [x] Renamed detached sub-session runtime/scope/error/event strings to plugin terminology.
- [x] Renamed built-in collaboration tool directory:
  - `agent/src/system-core/tools/workflow` → `agent/src/system-core/tools/collaboration`
- [x] Renamed memory abort helper:
  - `memory/experience/workflow.js` → `memory/experience/abort-control.js`
- [x] Renamed attachment/session helper paths and generation-source prefixes to plugin terminology.
- [x] Renamed semantic-transfer scenarios and strategies:
  - `bot_plugin`
  - `agent_plugin`
  - `bot_plugin_subagent_result`
  - `agent_plugin_stage_message`
  - `agent_plugin_summary_injection`
  - `agent_plugin_final_message`
- [x] Renamed semantic-transfer helper module:
  - `harness-transfer.js` → `plugin-stage-transfer.js`
- [x] Updated generic preparer/runtime/boundary/session tests away from `extension` wording and generic concrete-plugin fixtures.

## Current remaining concrete-name debt tracked by the guard

None in `agent/src/system-core`.

The remaining concrete plugin names are outside agent core (for example concrete plugin packages and integration tests that intentionally exercise those packages as external plugins).

## TODO

No remaining agent-core plugin-decoupling TODOs.

Future work should keep the guard empty and avoid reintroducing concrete plugin coupling into `agent/src/system-core`.

## Update procedure

When working on this area:

1. Prefer generic plugin names in new agent-core code.
2. Do not add compatibility aliases for specific plugins in agent core.
3. If a concrete plugin key appears, it must be external plugin manifest/config data, not agent-owned branching/defaulting/protocol/schema.
4. Run:

   ```bash
   npm run check:agent-plugin-decoupling
   npm -w agent test
   ```

5. If a new concrete plugin term appears in `agent/src/system-core`, remove it instead of adding a guard allowlist entry.
