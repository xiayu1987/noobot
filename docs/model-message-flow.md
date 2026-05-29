# 模型消息流文档索引

模型消息流按两种模式拆分为两份文档：

1. **插件参与模式（Agent + 插件侧）**  
   `docs/model-message-flow-plugin-mode.md`
2. **Agent 原生模式（无插件参与）**  
   `docs/model-message-flow-agent-native-mode.md`

> 建议：只在对应模式文档维护，避免两种模式混写导致口径冲突。

---

## 代码对齐约定（强制）

消息流文档应与以下代码保持一致，代码为真值来源：

- `agent/src/system-core/agent/core/context/message-builder.js`
- `agent/src/system-core/agent/core/turn/turn-executor.js`
- `agent/src/system-core/session/utils/context-window-normalizer.js`
- `plugin/noobot-plugin-harness/src/capabilities/runtime.js`
- `plugin/noobot-plugin-harness/src/core/hooks.js`

若文档与实现不一致，以代码为准并同步修正文档（尤其是 scope、默认值、调用顺序、最终过滤时机）。
