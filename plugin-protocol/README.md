# Noobot Plugin Protocol V2

`@noobot/plugin-protocol` is the single source of truth for Noobot plugin manifests,
surface activation, host ports, frontend extension points, and contribution validation.
Plugin discovery and module loading live in `@noobot/plugin-runtime`; Agent, Service, and
Frontend hosts own capability implementations and lifecycle event persistence.

## Contract

Each plugin has one strict `manifest.json` and one optional entry for each surface:

```json
{
  "protocolVersion": 2,
  "id": "example",
  "name": "example",
  "version": "1.0.0",
  "entries": { "agent": "src/entries/agent.js" },
  "contributes": {
    "agent": {
      "hooks": {
        "registers": ["agent.before_turn"],
        "emits": []
      }
    }
  },
  "requires": {
    "ports": ["hooks.register"],
    "permissions": [],
    "authenticatedRoutes": []
  },
  "enabledByDefault": true
}
```

Every declared surface entry exports only `activate(host, config)`. Activation returns:

```js
{
  protocolVersion: 2,
  pluginId: "example",
  surface: "agent",
  status: "activated",
  dispose() {}
}
```

The host validates every Hook registration, Hook emission, Service route binding, and
Frontend contribution against the same parsed Manifest. Handler ids are scoped by the
host. A plugin never receives an unrestricted HookManager or Express application.

## Ownership

| Concern | Authoritative project |
| --- | --- |
| Plugin manifest, activation, host ports, frontend points | `plugin-protocol` |
| Hook point names and execution semantics | `hook-protocol` |
| Discovery, strict loading, activation-result validation | `plugin-runtime` |
| Agent context envelopes | `context-protocol` |
| Host capability implementations and lifecycle events | Agent, Service, Frontend hosts |

There is no V1 translator, capability inference, alternate registration export, plugin
identity alias, or fallback plugin slot. Invalid enabled plugins fail closed.

## Verification

```bash
npm test -w @noobot/plugin-protocol
npm test -w @noobot/plugin-runtime
npm run check:plugin-protocol-boundary
npm run -w noobot-chat test:e2e:protocol -- --grep "PBE-027|PBE-028"
```

The browser cases verify real `plugin.activated` and `plugin.contribution_committed`
records in the session `runtime-events` store, including session, turn, dialog process,
surface, plugin id, and protocol version.
