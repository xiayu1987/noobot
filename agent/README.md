# agent-project

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

- Main entry: `agent-project`
- Subpaths:
  - `agent-project/agent`
  - `agent-project/tools`
  - `agent-project/model`
  - `agent-project/event`
  - `agent-project/tracking`
  - `agent-project/store`
  - `agent-project/session`
  - `agent-project/attach`
  - `agent-project/context`
  - `agent-project/config`

## Minimal usage example

```js
import { runAgentTurn } from "agent-project/agent";
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
