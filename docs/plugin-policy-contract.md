# Plugin Policy Contract

This document defines the unified runtime policy contract between Agent and plugins (for example harness/workflow).

Policy merge and tool selection are defined by
[`agent-config-protocol/src/policy/tool-policy.js`](../agent-config-protocol/src/policy/tool-policy.js).
The [plugin activation protocol](../plugin-protocol/src/activation.js) declares `policy.patch`;
the Agent supplies that port through its plugin host facade.

---

## 1) Ownership boundary

- **Configuration protocol owns** policy merging and tool selection rules.
- **Agent owns** activation, host port injection, and application of the resolved policy.
- **Plugin owns**
  - policy intent declaration (what to deny/allow for its own scenario)
  - calling the exposed policy API during plugin registration

So plugins should not patch agent internals directly.

---

## 2) Register-time API contract

When an agent plugin's `activate(host, config)` entry is called, Agent injects:

```ts
host.policy.patch(patch: object): object
```

Notes:

- return value is merged toolPolicy snapshot
- plugin should call API only for its own intent
- plugin may call `patch` multiple times; Agent merges each declaration

---

## 3) Canonical policy field

Canonical field:

- `runConfig.toolPolicy.denyToolNames: string[]`

No aliases are accepted. Unknown policy fields do not participate in tool filtering.

---

## 4) Merge and execution order

### 4.1 Merge order

For one run:

1. base `runConfig.toolPolicy`
2. plugin policy patch (via `host.policy.patch`)
3. canonical normalization (`denyToolNames` de-duplicated)

### 4.2 Tool filtering order

At tool registry/policy phase:

1. Apply `mode` (`custom_only` / `append_custom`) and explicit tool inclusion.
2. Resolve `allowToolNames`, including programming-required and declared plugin tools where applicable.
3. Apply `denyToolNames` (deny has final veto).
4. Remove repeated object references and require unique tool identities; conflicting names fail validation.

Tool identities here are internal names, not model-facing `bindingName` aliases.

---

## 5) Expected plugin usage pattern

```js
export function activate(host = {}, config = {}) {
  if (host?.policy?.patch && Array.isArray(config?.denyToolNames)) {
    host.policy.patch({ denyToolNames: config.denyToolNames });
  }
  // ...register hooks
}
```

---

## 6) Practical guidance

- New plugin: call the exposed `host.policy.patch` port, do not assume engine internals.
- Existing plugin: migrate old fields to `denyToolNames`.
- If multiple plugins declare deny lists in one run, Agent merges and de-duplicates.
