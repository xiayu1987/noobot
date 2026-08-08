# @noobot/semantic-transfer-protocol

Canonical protocol for semantic information transfer. This package owns only the V2 wire contract, canonical attachment references, strict validation, and pure direct/attachment policy decisions.

It has no filesystem, runtime, session repository, path resolver, or business-scenario dependency. Hosts materialize content through their attachment service and pass only the canonical attachment identity into the envelope.

## Invariants

- V2 is the only supported envelope version.
- `payload.mode` is either `direct` or `attachment`; the two payload forms are mutually exclusive.
- Attachment references contain an attachment-protocol identity and never a path.
- Invalid envelopes are rejected; they are not filtered, normalized from legacy shapes, or silently downgraded.
- A transfer is bound to stable `transferId`, `messageId`, and producer identity. `sessionId` is mandatory; execution-scoped transfers also carry `turnScopeId` and `runId`.
