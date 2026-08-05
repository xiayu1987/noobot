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

Runtime readers reject the previous schema. Existing artifacts must be changed
offline before deploying all components together.
