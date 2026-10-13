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

## Turn recovery

Reads never settle a Turn; settling is a write.

- `turn.snapshot.get` is a pure read. It loads the persisted lifecycle once and
  annotates the snapshot with the required `recovery` field
  (`TURN_RECOVERY_ACTION`), using the pure assessment `assessTurnRecovery` in
  `@noobot/authoritative-state`.
  - `none`: no active Turn, or nothing to settle yet (execution live, within
    the grace period, or liveness unknown).
  - `finalize`: the active Turn holds a retryable finalize intent; this wins
    over liveness.
  - `orphan`: the active Turn's execution is observed dead past the grace
    period.
- `recovery` is never a projected terminal state; the snapshot still reports
  the persisted active Turn, so `revision` and `sequence` stay authoritative.
  `finalize` and `orphan` require an `activeTurn`.
- Settling happens only through write entries, at most one commit each,
  idempotent by `commandId` plus `expectedRevision`:
  - `turn.finalize` settles the flagged Turn and returns the resulting
    snapshot; with nothing to settle it returns the current snapshot.
  - A new Turn command that hits `session_action_conflict` settles the blocking
    Turn and retries.
- Reconnect: the agent proxy sends `turn.finalize` once for a snapshot whose
  `recovery` is actionable and replaces the snapshot with the settled one. On
  failure it keeps the original snapshot and reconnect still completes.

Runtime readers reject the previous schema. Existing artifacts must be changed
offline before deploying all components together.
