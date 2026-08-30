# noobot-agent

[中文](./README.zh-CN.md) | English

Noobot's independent ESM Agent runtime. Service hosts inject configuration, storage, events, plugins, and model execution capabilities through declared package boundaries.

## Install And Verify

```bash
cd agent
npm install
npm run check
npm run check:tools
npm run check:api
npm test
```

## Public Entry Points

The authoritative list is `package.json#exports`. Main public subpaths include:

- `noobot-agent/agent`
- `noobot-agent/bot-manage`
- `noobot-agent/tools`
- `noobot-agent/model`
- `noobot-agent/event`
- `noobot-agent/tracking`
- `noobot-agent/store`
- `noobot-agent/session`
- `noobot-agent/attach`
- `noobot-agent/semantic-transfer`
- `noobot-agent/context`
- `noobot-agent/config`
- `noobot-agent/plugin`
- `noobot-agent/application`

Avoid deep-importing internal files.

## Minimal Usage

```js
import { runAgentTurn } from "noobot-agent/agent";
```

## Host Adapters

- Logging: `setLoggerAdapter`, `getLoggerAdapter`
- Events: `setEventAdapter`, `getEventAdapter`
- File storage: `setFsAdapter`, `getFsAdapter`, `resetFsAdapter`
- Tool construction: `setToolBuilderAdapter`, `getToolBuilderAdapter`, `resetToolBuilderAdapter`

Provider configuration and request execution are not Agent adapters. `@noobot/model-protocol` owns model contracts and `@noobot/model-runtime` owns provider execution.

## Environment

- `AGENT_GLOBAL_CONFIG_PATH` or `NOOBOT_GLOBAL_CONFIG_PATH`
- `AGENT_SYSTEM_PROMPT_PATH`
- `AGENT_WORKSPACE_ROOT`

## Plugin Policy

The Agent plugin host exposes the scoped `policy.patch(patch)` capability. Agent owns normalization and merge semantics; plugins declare policy intent only. See [Plugin Policy Contract](../docs/plugin-policy-contract.md) and [Plugin Protocol](../plugin-protocol/README.md).
