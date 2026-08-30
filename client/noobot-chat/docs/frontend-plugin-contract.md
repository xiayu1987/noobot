# Frontend Plugin Contract（Manifest V2）

前端插件与 Agent、Service 插件共用 `@noobot/plugin-protocol` 的 Manifest V2。协议版本、入口、Host Port、扩展点和贡献校验均由该包定义；本文只说明前端宿主如何使用该协议。

## 1）Manifest 与入口

插件根目录必须提供 `manifest.json`，并在同一个 Manifest 中声明前端入口、扩展贡献和所需 Host Port：

```json
{
  "protocolVersion": 2,
  "id": "example",
  "name": "example",
  "version": "1.0.0",
  "entries": { "frontend": "frontend/index.js" },
  "contributes": {
    "frontend": {
      "extensions": [{ "id": "example-card", "point": "message.card.pre" }]
    }
  },
  "requires": {
    "ports": ["frontend.contribute"],
    "permissions": [],
    "authenticatedRoutes": []
  },
  "enabledByDefault": true
}
```

入口只能导出 `activate(host, config)`。不存在 V1 注册函数、API 版本常量或备用入口。

```js
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";

export async function activate(host) {
  host.contributeExtension(host.extensionPoints.MESSAGE_CARD_PRE, {
    id: "example-card",
    component: ExampleCard,
    when: ({ messageItem } = {}) => messageItem?.type === "example",
    resolveProps: ({ messageItem } = {}) => ({ messageItem }),
  });
  return createPluginActivationResult({
    pluginId: host.pluginMeta.pluginId,
    surface: PLUGIN_SURFACE.FRONTEND,
  });
}
```

## 2）前端 Host 能力

- `host.contributeExtension(point, contribution)`：提交 Manifest 已声明的扩展。
- `host.extensionPoints`：`@noobot/plugin-protocol` 暴露的扩展点常量。
- `host.pluginMeta`：已校验的插件身份、名称、版本和协议版本。
- `host.logger`：宿主日志接口。
- `host.services.authenticatedRequest.request`：仅当 Manifest 声明 `authenticated_request`、相应权限和路由白名单时提供。

插件不能访问前端内部 registry，也不能注册 Manifest 未声明的扩展。重复的 `point + id` 在同一插件激活事务中直接失败。

## 3）当前扩展点

扩展点的唯一枚举维护在 `plugin-protocol/src/frontend.js`：

- `message.card.pre`、`message.card.post`
- `message.action.after-pre-cards`、`message.action.post-content`
- `composer.options.model`、`composer.model-options`、`composer.more.actions`
- `markdown.collapse.markers`
- `runtime.stream.route`
- `session.detail.hydrator`、`session.artifact.panel`
- `right.tool.panel`

## 4）加载与失败语义

`client/noobot-chat/scripts/generate-frontend-plugin-entries.js` 只扫描通过 Manifest V2 校验且存在前端入口的插件，并生成入口映射。宿主使用 `@noobot/plugin-runtime` 完成事务化激活：任何入口、权限或贡献校验失败都会回滚该插件本轮贡献，不存在 V1 转换、能力推导或备用插槽。

完整协议见 [`@noobot/plugin-protocol`](../../../plugin-protocol/README.md)。
