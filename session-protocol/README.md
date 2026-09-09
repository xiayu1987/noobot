# @noobot/session-protocol

This package is the single source of truth for Session aggregate identity,
commands, authoritative Turn events, snapshots, results and pure policies.

## Ownership

- A Session has exactly one wire identity: `sessionId`.
- A Session aggregate has exactly one optimistic concurrency coordinate:
  `aggregateVersion`.
- A Turn has `turnScopeId`, `dialogProcessId` and its own `revision`.
- Turn replacement allocates `replacementDialogProcessId` in the Session
  authority transaction. The replacement user message, replacement commit,
  lifecycle tombstone and subsequent `turn.resend` command must carry that
  exact identity. Execution may verify it but must never generate or rewrite it.
- Session event ordering uses `sequence`.
- Command idempotency uses `commandId`; another idempotency key is forbidden.
- Storage paths and persistence contexts are host implementation details and
  must never enter commands, events, snapshots or browser requests.

## Module layout

Every symbol has exactly one defining module. Public subpaths in
`package.json#exports` are the only supported import surface; they re-export the
canonical definition instead of duplicating it.

- `src/identity/` defines Session and Turn identity. `canonicalizeTurnScopeId`,
  `turnScopeIdentityKey` and `areCanonicalTurnScopeIdsEqual` are defined only in
  `src/identity/turn-scope-identity.js`.
- `src/lifecycle/` holds Turn lifecycle building blocks: `turn-state.js`,
  `turn-event.js`, `turn-transition-policy.js`, `turn-capability.js`,
  `turn-timing.js`, `turn-continuation.js`, `turn-replacement.js`,
  `turn-terminal.js`, `execution-abort.js`, plus `turn-projection.js`
  (`snapshotTurn`, `snapshotReplacedTurn`), `turn-terminal-resolution.js` and
  the shared field assertions in `turn-field-assertions.js`.
- `src/transport/turn-user-message-event.js` builds the shared user-message
  event protocol template. `turn-commit.js` and `turn-attachment-bind.js` keep
  their own canonical `validate*`/`assert*` definitions on top of it.
- `src/turn-lifecycle.js` owns lifecycle envelopes, snapshots and receipts and
  re-exports the lifecycle submodules it composes.

`scripts/check-session-protocol-boundary.mjs` enforces these definition sites.

Runtime readers reject the previous schema. Existing artifacts must be changed
offline before deploying all components together.
