# Bot Manager Architecture

`agent/src/bot` owns Session-level orchestration around the Agent runtime. It does not own provider adaptation, transport protocol definitions, or plugin implementations.

## Layers

- `index.js`: public `BotManager` facade and dependency wiring.
- `execution/`: run initialization, authoritative Turn execution, persistence, finalization, memory post-processing, and parent async-task coordination.
- `session/`: Session execution engine, detached sub-Sessions, plugin runtime preparation, artifact commits, attachment enrichment, and summary checkpoints.
- `async/`: generic asynchronous job lifecycle and Session wrappers.
- `config/`: built-in scenario resolution and input validation.
- `hook/`: Bot-level orchestration Hook adapter.
- `workspace-infra/`: workspace capability adapter.

## Main Flow

```text
BotManager.runSession
  -> SessionExecutionEngine.runSession
    -> execution/runner.runSession
      -> initialize run and authority state
      -> prepare Agent Turn execution
      -> run Agent Turn
      -> persist and finalize
      -> run memory post-processing
```

## Boundaries

- Session identities, aggregate versions, Turn revisions, lifecycle and receipts come from `@noobot/session-protocol`.
- Provider requests run only through `@noobot/model-runtime`.
- Plugin activation uses `@noobot/plugin-runtime`; plugins receive only declared Host Ports.
- Detached sub-Sessions use explicit persistence scope and never infer root Session paths.
- New orchestration code belongs in its semantic layer; do not add path-level compatibility facades or duplicate protocol normalization.
