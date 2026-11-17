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
- `noobot-agent/bot`
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

## 已受理运行上下文

Session 门面的 `getSessionRunContext({ userId, sessionId, turnScopeId,
dialogProcessId, persistenceScope })` 依据规范会话清单校验已受理轮次，返回
`{ startedAt, modelAlias, parentSessionId, sessionDir }`。初始化通过此契约获取事实，
无需物化消息正文或通过单轮视图加载历史检查点。已删除会话、缺失轮次及对话身份不匹配均拒绝读取。
`locateSessionScope` 继续作为宿主工作区路由的定位契约。

## 检查点读取

存储 `readJson(path, { immutable: true, previousValue })` 每次读取源文件，只有原始内容
SHA-256 一致时才复用读取器拥有的深度冻结值；普通读取仍返回独立可变值。读取器以弱引用
记录源内容哈希，不额外保留检查点正文。
快照校验保留读取前后的文件身份检查、近期文件保护、规范内容哈希及链路和索引检查。
复用只消除相同不可变对象的重复解析和哈希计算；文件缺失、变更和损坏仍明确报错。

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

- `NOOBOT_GLOBAL_CONFIG_PATH`
- `AGENT_SYSTEM_PROMPT_PATH`

工作区根目录不是环境变量，由全局配置字段 `workspace_root` 经 `@noobot/path-resolver` 统一解析。

## 插件策略

Agent 插件宿主只暴露受限的 `policy.patch(patch)` 能力。Agent 负责规范化与合并，插件只声明策略意图。参见[插件策略契约](../docs/plugin-policy-contract.md)和[插件协议](../plugin-protocol/README.md)。
