# Plugin Policy Contract (Agent-owned, Plugin-declared)

Last updated: **August 5, 2026**

This document defines the unified runtime policy contract between Agent and plugins (for example harness/workflow).

---

## 1) Ownership boundary

- **Agent owns**
  - policy field schema and normalization
  - merge precedence
  - actual tool filtering execution
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

1. `allowToolNames` filter (if configured)
2. `denyToolNames` filter (deny has final veto)
3. dedupe by tool name

At runtime tool build phase, deny is enforced again for safety.

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

- New plugin: only call `api.policy.*`, do not assume engine internals.
- Existing plugin: migrate old fields to `denyToolNames`.
- If multiple plugins declare deny lists in one run, Agent merges and de-duplicates.
