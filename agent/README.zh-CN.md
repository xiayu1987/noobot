# noobot-agent

中文 | [English](./README.md)

Noobot 独立的 ESM Agent 运行时。Service 宿主通过声明的包边界注入配置、存储、事件、插件和模型执行能力。

## 安装与校验

```bash
cd agent
npm install
npm run check
npm run check:tools
npm run check:api
npm test
```

## 对外入口

唯一完整清单以 `package.json#exports` 为准，主要公开子路径包括：

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

禁止深层导入内部文件。

## 最小示例

```js
import { runAgentTurn } from "noobot-agent/agent";
```

## 宿主 Adapter

- 日志：`setLoggerAdapter`、`getLoggerAdapter`
- 事件：`setEventAdapter`、`getEventAdapter`
- 文件存储：`setFsAdapter`、`getFsAdapter`、`resetFsAdapter`
- 工具构建：`setToolBuilderAdapter`、`getToolBuilderAdapter`、`resetToolBuilderAdapter`

Provider 配置和模型请求执行不是 Agent Adapter。`@noobot/model-protocol` 负责模型契约，`@noobot/model-runtime` 负责供应商请求执行。

## 环境变量

- `AGENT_GLOBAL_CONFIG_PATH` 或 `NOOBOT_GLOBAL_CONFIG_PATH`
- `AGENT_SYSTEM_PROMPT_PATH`
- `AGENT_WORKSPACE_ROOT`

## 插件策略

Agent 插件宿主只暴露受限的 `policy.patch(patch)` 能力。Agent 负责规范化与合并，插件只声明策略意图。参见[插件策略契约](../docs/plugin-policy-contract.md)和[插件协议](../plugin-protocol/README.md)。
