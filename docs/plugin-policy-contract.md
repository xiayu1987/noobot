# Plugin Policy Contract (Agent-owned, Plugin-declared)

Last updated: **June 5, 2026**

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

When `registerNoobotPlugin(api, options)` is called, Agent injects:

```ts
api.policy.appendDenyToolNames(names: string[]): object
api.policy.setToolPolicy(patch: object): object
api.policy.getToolPolicy(): object
```

Notes:

- return value is merged toolPolicy snapshot
- plugin should call API only for its own intent
- plugin can call none/one/multiple methods

---

## 3) Canonical policy field

Canonical field:

- `runConfig.toolPolicy.denyToolNames: string[]`

Legacy compatibility aliases (accepted, deprecated):

- `runConfig.toolPolicy.deny_tool_names`
- `runConfig.toolPolicy.disableAgentCollabTools`
- `runConfig.toolPolicy.disable_agent_collab_tools`

Migration recommendation (since **June 5, 2026**): use only `denyToolNames`.

---

## 4) Merge and execution order

### 4.1 Merge order

For one run:

1. base `runConfig.toolPolicy`
2. plugin policy patch (via `api.policy.*`)
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
export function registerNoobotPlugin(api = {}, options = {}) {
  if (api?.policy?.appendDenyToolNames && Array.isArray(options?.denyToolNames)) {
    api.policy.appendDenyToolNames(options.denyToolNames);
  }
  // ...register hooks
}
```

---

## 6) Compatibility matrix

| Field | Status | Effective date |
|---|---|---|
| `toolPolicy.denyToolNames` | Canonical | June 5, 2026 |
| `toolPolicy.deny_tool_names` | Deprecated (compat) | kept after June 5, 2026 |
| `toolPolicy.disableAgentCollabTools` | Deprecated (compat) | kept after June 5, 2026 |
| `toolPolicy.disable_agent_collab_tools` | Deprecated (compat) | kept after June 5, 2026 |

---

## 7) Practical guidance

- New plugin: only call `api.policy.*`, do not assume engine internals.
- Existing plugin: migrate old fields to `denyToolNames`.
- If multiple plugins declare deny lists in one run, Agent merges and de-duplicates.
