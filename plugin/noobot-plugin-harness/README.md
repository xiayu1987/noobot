# noobot-plugin-harness

Hook-based Harness Engineering plugin for Noobot.

The plugin is non-invasive: it is attached through Noobot hooks, and hook errors are captured by Noobot's hook manager instead of breaking the main agent flow.

## Capabilities

- Writes run manifest: `runtime/harness/runs/{dialogProcessId}/harness-run.json`
- Writes lifecycle event stream: `events.jsonl`
- Writes context snapshot: `context-snapshot.json`
- Writes prompt injection records: `prompts.jsonl`
- Writes tool call index: `tool-calls.jsonl`
- Writes state commit index: `state-commits.jsonl`
- Injects lightweight prompt policy through `before_llm_call`
- Injects final response guard through `before_final_output`

## Recommended usage: enable from runConfig

`SessionExecutionEngine.runSession()` can automatically create/reuse `hookManager` and register this plugin.

```js
await botManager.runSession({
  userId,
  sessionId,
  message: "hello",
  runConfig: {
    plugins: {
      harness: {
        enabled: true
      }
    }
  }
});
```

Shorthand forms are also supported:

```js
runConfig: {
  enableHarness: true
}
```

```js
runConfig: {
  harness: true
}
```

## Enable from globalConfig

Harness can be enabled globally, then overridden by per-run config.

```json
{
  "plugins": {
    "harness": {
      "enabled": true,
      "trace": true,
      "promptPolicy": true
    }
  }
}
```

Per-run config takes precedence over global config:

```js
runConfig: {
  plugins: {
    harness: {
      enabled: false
    }
  }
}
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enables plugin registration. In `runSession`, the plugin is registered only when explicitly enabled by `runConfig` or `globalConfig`. |
| `basePath` | current user workspace | Root workspace for harness output. If omitted, `SessionExecutionEngine` resolves it from `workspaceService.getWorkspacePath(userId)`. |
| `trace` | `true` | Writes hook events to `events.jsonl` and related index files. |
| `promptPolicy` | `true` | Injects a lightweight system message before LLM calls. |
| `finalResponseGuard` | `true` | Reserved option for final response guard behavior. |
| `writeContextSnapshot` | `true` | Writes `context-snapshot.json` after context build. |
| `writePrompts` | `true` | Writes prompt injection records to `prompts.jsonl`. |
| `runtimeDirName` | `runtime` | Runtime directory name below `basePath`. |
| `harnessDirName` | `harness` | Harness directory name below runtime directory. |
| `promptPriority` | `80` | Hook priority for prompt injection handlers. |
| `tracePriority` | `20` | Hook priority for trace handlers. |
| `timeoutMs` | `1000` | Hook handler timeout. |
| `maxPreviewChars` | `1200` | Maximum preview size for recorded payload snippets. |
| `promptText` | built-in policy | System prompt text injected at `before_llm_call`. |
| `finalResponseText` | built-in guard | System prompt text injected at `before_final_output`. |

## Output directory

Default output path:

```text
workspace/{userId}/runtime/harness/runs/{dialogProcessId}/
```

If `basePath` is provided, output path becomes:

```text
{basePath}/runtime/harness/runs/{dialogProcessId}/
```

## Output files

```text
harness-run.json       Run manifest: ids, status, timestamps, output paths, last event.
context-snapshot.json  Sanitized context summary after context build.
events.jsonl           Hook lifecycle event stream.
prompts.jsonl          Prompt/final-response guard injection records.
tool-calls.jsonl       Tool-call related hook events.
state-commits.jsonl    State-commit related hook events.
policy-checks.json     Reserved for policy check results.
```

JSONL files contain one JSON object per line, suitable for streaming and incremental inspection.

## Minimal example config

See:

```text
plugin/noobot-plugin-harness/examples/run-config.example.json
```

## Manual hookManager usage

Manual registration is still supported when running outside `SessionExecutionEngine.runSession()`.

```js
import { createHookManager } from "noobot-agent/hook";
import { registerNoobotPlugin } from "./plugin/noobot-plugin-harness/src/index.js";

const hookManager = createHookManager();

registerNoobotPlugin({ hookManager }, {
  basePath: "/path/to/workspace/user",
  promptPolicy: true,
  trace: true
});

runConfig.hookManager = hookManager;
```

## Validation

```bash
npm --prefix plugin/noobot-plugin-harness test
npm --prefix plugin/noobot-plugin-harness run check
```
