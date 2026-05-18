# noobot-agent

English: [README.md](./README.md)

从 `noobot/service/system-core` 抽离出的独立 Agent Runtime 项目（ESM）。

## 安装

```bash
cd agent
npm install
```

## 快速校验

```bash
npm run check
npm run check:tools
npm run check:api
```

## 对外入口

- 主入口：`noobot-agent`
- 子路径：
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

## 最小示例

```js
import { runAgentTurn } from "noobot-agent/agent";
```

## Adapter 扩展点

- Logger：`setLoggerAdapter` / `getLoggerAdapter`
- Event：`setEventAdapter` / `getEventAdapter`
- Store(FS)：`setFsAdapter` / `getFsAdapter` / `resetFsAdapter`
- Tools：`setToolBuilderAdapter` / `getToolBuilderAdapter` / `resetToolBuilderAdapter`
- Model：`setModelAdapter` / `getModelAdapter` / `resetModelAdapter`

## 已接入环境变量

- `AGENT_GLOBAL_CONFIG_PATH`（兼容 `NOOBOT_GLOBAL_CONFIG_PATH`）
- `AGENT_SYSTEM_PROMPT_PATH`
- `AGENT_WORKSPACE_ROOT`

## 与 noobot 原版的迁移差异

1. **项目形态**
   - 从 `noobot/service/system-core` 独立为 `noobot/agent`。
2. **路径默认值去硬编码**
   - 全局配置、system prompt、workspace root 支持环境变量覆盖。
3. **运行时可插拔**
   - 新增 logger/event/store/tool/model adapter 层。
4. **公开 API 收口**
   - 通过 `package.json#exports` 暴露受控子路径，建议避免 deep import。
5. **依赖分层**
   - 核心依赖与可选依赖（optionalDependencies）已区分，连接器/文档处理类能力可按需安装。

## 说明

- 默认行为尽量保持与原 `system-core` 一致。
- 若你准备发布 npm 包，建议下一步补充：版本策略、变更日志、最小示例工程。

