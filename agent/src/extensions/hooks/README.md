# Agent Hook Runtime Adapter

This directory adapts the shared `@noobot/hook-protocol` to Agent runtime
contexts and telemetry. It does not own a Manager implementation or point list.

Use `createHookManager` and `HOOK_POINT` from `@noobot/hook-protocol` for
registration. Agent runtime resolution accepts only `runtime.hookManager`.
`runAgentRuntimeHook` builds and validates the Agent Hook Context, forwards the
runtime abort signal, and emits sanitized runtime telemetry around `emit`.

The authoritative protocol, result shape, failure semantics, and complete point
list are documented in `hook-protocol/README.md`.
