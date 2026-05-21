# Harness Plugin Architecture

## Semantic layout

- `src/core/`
  - `plugin.js`: plugin factory + registration flow
  - `hooks.js`: hook point policy + hook registration
  - `context.js`: runtime/hook context resolution
  - `options.js`: option schema + normalization
  - `thresholds.js`: shared thresholds and retry limits
  - `constants.js`: plugin metadata + hook constants
- `src/capabilities/`: capability profile, hook map, runtime dispatcher, handlers
- `src/fsm/`: state machine transitions + audit commits
- `src/takeover/`: capability directives takeover dispatcher
- `src/tracing/`: trace events, prompt injection, run trace sink
- `src/prompt/`: prompt marker and dedupe helper
- `src/store/`: manifest/jsonl buffered persistence
- `src/utils/`: run cleanup utilities
- `src/data/`: record builders/shared serialization helpers

## Public API

`src/index.js` is the only public entry, re-exporting core plugin APIs and takeover dispatcher.
