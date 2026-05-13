# bot-manage Architecture (semantic regrouping)

## 1) Layered structure

- **Facade**
  - `index.js` (`BotManager`) – external API and dependency wiring
- **Execution domain**
  - `execution/runner.js` – main session pipeline orchestration
  - `execution/initializer.js` – runtime/session init
  - `execution/finalizer.js` – persistence + memory post-process + result shaping
  - `execution/turn-persister.js` – append turn / append messages
  - `execution/parent-async-task-manager.js` – parent async task container state machine
  - `execution/memory-postprocess.js` – memory summarize/post-process flow
  - `execution/agent-context-factory.js` – context builder and runtime context normalization
- **Async domain**
  - `async/manager.js` – generic job lifecycle
  - `async/session-runner.js` – session-specific async wrappers (legacy API)
  - `async/response-builder.js` – async response DTOs
- **Config domain**
  - `config/run-config-resolver.js` – scenario/runConfig resolve and tool policy scoping
  - `config/validator.js` – input/config validator
  - `config/scenario-resolver.js` – scenario parser
  - `config/tool-policy-manager.js` – tool policy builder
  - `config/constants.js` – grouped constants
- **Session orchestration**
  - `session/session-execution-engine.js` – coordinator + stable runtime surface
- **Infra**
  - `workspace-infra/workspace-service.js`

## 2) Runtime call graph

```text
BotManager.runSession
  -> SessionExecutionEngine.runSession
    -> execution/runner.runSession
      -> execution/initializer.initializeRunSessionRuntime
      -> execution/agent-context-factory.build*Context
      -> agentRunner (runAgentTurn)
      -> execution/finalizer.finalizeRunSession
         -> execution/turn-persister.appendAgentMessages
         -> execution/memory-postprocess.runMemoryPostProcessFlow
```

## 3) Async call graph

```text
BotManager.runAsyncSession / waitAsyncSession
  -> AsyncJobManager
     -> async/session-runner (legacy session async API)
     -> async/manager (generic job lifecycle)
```

## 4) Stability rules

- Keep existing public API and method names intact.
- Inside `bot-manage`, avoid path-level re-export shims unless migration is in progress.
- Refactor policy: **no behavior change, only responsibility split**.
