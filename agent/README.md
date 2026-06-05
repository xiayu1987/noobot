# noobot-agent

Chinese version: [README.zh-CN.md](./README.zh-CN.md)

An independent Agent Runtime project (ESM), extracted from `noobot/service/system-core`.

## Install

```bash
cd agent
npm install
```

## Quick checks

```bash
npm run check
npm run check:tools
npm run check:api
```

## Public entry points

- Main entry: `noobot-agent`
- Subpaths:
  - `noobot-agent/agent`
  - `noobot-agent/tools`
  - `noobot-agent/model`
  - `noobot-agent/event`
  - `noobot-agent/tracking`
  - `noobot-agent/store`
  - `noobot-agent/session`
  - `noobot-agent/attach`
  - `noobot-agent/context`
  - `noobot-agent/config`

## Minimal usage example

```js
import { runAgentTurn } from "noobot-agent/agent";
```

## Adapter extension points

- Logger
  - `setLoggerAdapter`, `getLoggerAdapter`
- Event
  - `setEventAdapter`, `getEventAdapter`
- Store(FS)
  - `setFsAdapter`, `getFsAdapter`, `resetFsAdapter`
- Tools
  - `setToolBuilderAdapter`, `getToolBuilderAdapter`, `resetToolBuilderAdapter`
- Model
  - `setModelAdapter`, `getModelAdapter`, `resetModelAdapter`

## Supported environment variables

- `AGENT_GLOBAL_CONFIG_PATH` (or compatible `NOOBOT_GLOBAL_CONFIG_PATH`)
- `AGENT_SYSTEM_PROMPT_PATH`
- `AGENT_WORKSPACE_ROOT`

## Notes

- Default behavior is kept aligned with the original `system-core`.
- Public APIs are narrowed via `exports`; avoid deep-importing internal files.

## Plugin policy API (registerNoobotPlugin)

Agent injects a unified `api.policy` contract when registering plugins:

- `appendDenyToolNames(names: string[])`
- `setToolPolicy(patch: object)`
- `getToolPolicy(): object`

Contract: agent owns policy normalization/merge; plugins only declare policy intents (for example appending `denyToolNames`).

Detailed contract: `../docs/plugin-policy-contract.md`
