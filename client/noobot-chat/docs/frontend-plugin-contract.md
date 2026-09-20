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
      "extensions": [
        {
          "id": "example-card",
          "point": "message.card.pre",
          "component": {
            "module": "./frontend/ExampleCard.vue",
            "export": "default"
          }
        }
      ]
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
    when: ({ messageItem } = {}) => messageItem?.type === "example",
    resolveProps: ({ messageItem } = {}) => ({ messageItem }),
  });
  return createPluginActivationResult({
    pluginId: host.pluginMeta.pluginId,
    surface: PLUGIN_SURFACE.FRONTEND,
  });
}
```

组件模块只能在 Manifest 的 `component` 中声明。插件入口不导入组件，也不调用
`defineAsyncComponent`；构建发现阶段为声明生成静态 `import()` loader，`plugin-runtime`
校验声明与 loader 一一对应，前端宿主在提交扩展事务时物化为异步 Vue 组件。入口再次传入
`component` 会直接失败，不存在手工加载分支。

本地组件模块必须使用相对插件根目录的 `./` 路径；宿主公开的插件 API 可以使用包导出名，
例如 `{ "module": "noobot-chat/plugin-api/chat-ui", "export": "ThinkingPanel" }`。
组件型扩展点必须声明组件模块，投影器、路由器、水合器等 provider 扩展点禁止声明组件。

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

加载边界固定为两级：宿主先按需加载插件入口；只有扩展实际渲染时，才加载 Manifest 声明的
组件模块。组件内部更细的重能力（例如 3D 物理引擎）仍由插件在能力触发点继续拆分，因为这部分
属于插件内部实现，不进入宿主扩展协议。

完整协议见 [`@noobot/plugin-protocol`](../../../plugin-protocol/README.md)。
