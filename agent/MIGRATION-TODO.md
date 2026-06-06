# Migration TODO

- [x] Bootstrap standalone agent project
- [x] Copy `service/system-core` into `src/system-core`
- [x] Install runtime dependencies based on actual imports
- [x] Replace hard-coded path defaults (`./config`, `./system-core/system-prompt/base.md`, `process.cwd()` assumptions)
- [x] Introduce runtime adapters (logger/event/store/tool/model)
  - [x] logger adapter (`setLoggerAdapter` / `getLoggerAdapter`)
  - [x] event adapter (`setEventAdapter` / `getEventAdapter`)
  - [x] store adapter (`setFsAdapter` / `getFsAdapter` / `resetFsAdapter`)
  - [x] tool adapter (`setToolBuilderAdapter` / `getToolBuilderAdapter` / `resetToolBuilderAdapter`)
  - [x] model adapter (`setModelAdapter` / `getModelAdapter` / `resetModelAdapter`)
- [x] Narrow public API exports and remove deep-import reliance
  - [x] add package `exports` map (public subpaths only)
  - [x] add barrel entries `src/index.js` + `src/system-core/index.js`
- [x] Migrate system-core tests to `agent/__tests__/system-core`
  - [x] rewrite imports from `system-core/*` to `src/system-core/*`
  - [x] add agent test scripts (`test`, `test:bot-manage`, `test:tools`)

## Next migration candidates (service -> agent)

- [x] Migrate `service/__tests__/utils` (8 files) to `agent/__tests__/system-core/utils`
  - [x] `mime-utils.test.js` (pure utility, low risk)
  - [x] `terminal-output-cleaner.test.js` (pure utility, low risk)
  - [x] `text-cleaner.test.js` (pure utility, low risk)
  - [x] `web-error-strategy.test.js` (depends on mocked `globalThis.fetch`, medium risk)
  - [x] `web2img-clean-ordered.test.js` (pure utility, low risk)
  - [x] `web2img-config.test.js` (optional deps probing, medium risk)
  - [x] `web2img-extract.test.js` (mock page object, low risk)
  - [x] `web2img-interact-capture.test.js` (mock page object, low risk)

- [x] Migrate `service/__tests__/connectors` (4 files) to `agent/__tests__/system-core/connectors`
  - [x] `channel-store.test.js` (in-memory store behavior, low risk)
  - [x] `connector-event-listener.test.js` (bridge contract assertions, low risk)
  - [x] `emails/connection.test.js` (normalization/validation, low risk)
  - [x] `emails/email-connector-channel.test.js` (error-path only, medium risk)

- [x] Migration notes
  - [x] Rewrite imports from `../../system-core/*`/`../../../system-core/*` to `../../../src/system-core/*` (or equivalent by final test path).
  - [x] Keep these tests offline-safe (no real SMTP/IMAP/DB/SSH network in CI).
  - [x] Optionally add npm scripts:
    - [x] `test:utils` -> `node --test --test-force-exit __tests__/system-core/utils/*.test.js __tests__/system-core/utils/**/*.test.js`
    - [x] `test:connectors` -> `node --test --test-force-exit __tests__/system-core/connectors/*.test.js __tests__/system-core/connectors/**/*.test.js`
  - [x] Adjust migrated assertion in `mime-utils.test.js`: `image/svg+xml` now expects exact-map `.svg` (instead of prefix fallback `.png`).
  - [x] Run full agent test suite (`npm test`) after migration.

## Remaining service tests (not agent package scope for now)

- [x] `service/__tests__/routes/*`
  - `file-crud-routes.test.js`
  - `route-wrapper.test.js`
  - `session-routes.test.js`
- [x] `service/__tests__/system-core/tools/check-openai-tool-schema-script.test.js`

## Service-side legacy system-core tests deprecation

- [x] Deprecate and remove legacy test files that directly targeted `service/system-core`:
  - [x] `service/__tests__/utils/*`
  - [x] `service/__tests__/connectors/*`
- [x] Trim service npm test scripts to non-legacy scope (`routes` + `check-openai-tool-schema-script`).
- [x] Remove legacy implementation directory `service/system-core`.

## Plugin dynamic discovery / decoupling migration notes

- [x] Dynamic plugin loading pipeline is now enabled:
  - scan `plugin/*`
  - read/validate `manifest.json`
  - dynamic `import(entry)`
  - register exported `registerNoobotPlugin`
  - expose diagnostics via `/internal/plugins`
- [x] Service side no longer statically imports harness/workflow plugin entry points.
- [x] Service hook registration now resolves plugins by service event capability (`service.after_session_delete`), not plugin id.
- [x] Agent side no longer statically imports harness/workflow plugin entry points.
- [x] Agent capability registration uses generic capability keys:
  - `agent.register`
  - `bot.register`
- [x] Runtime plugin options are read from manifest `runtimeOptions` (for service event path).
- [x] `session-execution-engine` plugin option read/write supports dynamic plugin keys.
  - read path: resolve by loaded plugin key (with compatibility selectors)
  - write path: store to `runConfig.plugins[resolvedPluginKey]`
- [x] Compatibility kept for legacy config keys during migration:
  - `runConfig.plugins.harness`
  - `runConfig.plugins.workflow`
  - `selectedPlugins` still accepts `harness` / `workflow` aliases
- [ ] Next step (optional): publish a formal deprecation window for legacy aliases
      (`harness`/`workflow`) and add startup warnings before removal.
