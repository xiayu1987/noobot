# @noobot/event-protocol

This package is the single source of truth for the versioned authority event
protocol: envelopes, the event family registry, replay batches and the delivery
outbox.

## Ownership

- Every authority event carries one envelope shape built by
  `src/envelope.js`; producers must not assemble envelope fields by hand.
- `src/event-registry.js` owns the event family table and the wire-event index.
  It is the only place that maps a wire event to its family, reducer input and
  payload reader.
- Domain payload validation lives in `src/event-registry-validators.js`. The
  registry composes those validators and never inlines payload rules.
- Turn ordering and identity come from `@noobot/session-protocol`; this package
  validates them but never defines or rewrites them.

## Module layout

Public subpaths in `package.json#exports` are the supported import surface.
`src/index.js` aggregates the modules that make up the protocol surface;
`./message-event` and `./workflow-runtime-event` are reached through their own
subpaths. Both already sit inside the `src/index.js` module graph because
`src/event-registry.js` composes them, so importing either subpath adds no
module-loading cost over the main entry.

- `src/normalize.js` holds the shared normalization helpers. It exposes three
  deliberately distinct string variants, because the call sites are not
  interchangeable:
  - `text` uses `String(value || "").trim()` and maps `0` and `false` to the
    empty string. This is the default for identity and label fields.
  - `nullishText` uses `String(value ?? "").trim()` and preserves `0` as `"0"`.
    `src/plugin-artifact-event.js` depends on this for token validation.
  - `collapsedText` additionally collapses internal whitespace runs.
    `src/tool-presentation.js` depends on this for display output.
    Merging these variants changes observable behaviour and is not a refactor.
- `src/event-registry-validators.js` defines the attachment, execution,
  interaction and message envelope validators plus the shared `domainResult`
  helper.
- `src/authority-event-outbox.js` and `src/replay-batch.js` cover delivery and
  replay ordering.

## Guards

`scripts/check-barrel-star-exports.mjs` fails the build when two `export *`
sources in one barrel own the same symbol name, because ESM drops such symbols
silently instead of raising a conflict. The guard resolves each barrel through a
real dynamic import; barrels it cannot load in plain Node are counted as skipped
rather than passing, and `client/noobot-chat/src/public/index.js` is currently
skipped because it re-exports `.vue` modules.
