# Frontend Plugin Contract（API v1）

> 本文定义 `plugin/*/frontend` 入口协议，供前端 registry 自动加载使用。

## 1) 入口文件约定

插件前端入口文件建议路径：

```txt
plugin/<plugin-name>/frontend/index.js
```

必须导出：

```js
export const FRONTEND_PLUGIN_API_VERSION = "1";
export function registerFrontendPlugin(ctx) {}
```

---

## 2) ctx 参数约定

`registerFrontendPlugin(ctx)` 中可用：

- `ctx.registerFrontendPlugin(definition)`：向 host registry 注册能力
- `ctx.pluginMeta`：插件元信息（id/name/version）
- `ctx.logger`：可选日志方法（`info/warn/error`）

---

## 3) definition 最小结构

```js
ctx.registerFrontendPlugin({
  id: "workflow",
  name: "workflow-message-card",
  capabilities: ["message.card.workflow"],
  messageCards: [
    {
      id: "workflow-card",
      capability: "message.card.workflow",
      slot: "pre", // pre | post
      priority: 100,
      component: WorkflowMessageCard,
      match: (messageItem = {}) => messageItem?.workflowMessage === true,
      resolveProps: (context = {}) => ({
        messageItem: context?.messageItem || {},
      }),
      resolveListeners: () => ({}),
    },
  ],
  messageActions: [],
});
```

---

## 4) 兼容与失败处理建议

1. 若 `FRONTEND_PLUGIN_API_VERSION !== "1"`，host 应跳过并告警。
2. 若插件入口加载失败，host 仅告警，不中断主应用启动。
3. 同 `id` 重复注册时，建议后注册忽略并告警（避免双渲染）。

---

## 5) 与编译链路的关系

建议在插件 manifest 中声明：

```json
{
  "frontend": {
    "apiVersion": "1",
    "entry": "frontend/index.js"
  }
}
```

由 `generate-frontend-plugin-entries` 脚本统一扫描并生成前端入口映射。

