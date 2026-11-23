# Context protocol

## Message attachments

`resolveContextMessageAttachments` defines the attachment projection used by model user metadata. Message `attachments` and attachment-mode `transferEnvelopes` contribute distinct identities; neither source suppresses the other. Source-reference envelopes remain references and are not converted into attachments.

Identity is the canonical `attachmentId`, `sessionId`, `attachmentSource` triple. Transfer descriptors use nested `identity`; the context projection explicitly maps this to model metadata. Entries with the same identity appear once. Shared `name`, `mimeType` and `size` values must agree; conflicting values throw `context_attachment_metadata_conflict:<field>`. A field supplied by only one representation is preserved. No file paths or inferred identities are introduced.

Missing message array fields mean an empty list. Non-array values are invalid. Tool-result storage retains the authoritative result; model projection may compact empty fields without modifying stored results.

## Stopped snapshot source selection

`projectSnapshotUserSourceSelection` selects persisted natural user sources from
history and incremental blocks using the Session turn-view selection contract.
It preserves first-occurrence message UID order and includes declared source
turn scopes. Missing scope metadata is not inferred; message identity remains
the lookup key. Internal user messages are excluded. The Session service receives
both arrays and restores attachment facts from authoritative Session messages;
missing sources or conflicting facts fail explicitly. Snapshot attachment copies
never become an alternative authority.

## Summary checkpoint predecessor

Within a session and turn scope, `expectedCheckpointRevision` identifies the
predecessor; zero identifies the initial state. `createSummaryCheckpointId`
binds the ordered message delta and this predecessor into the operation identity.
The producer captures the revision with the delta and preserves both on retry.
The transaction compares a new request against the owning checkpoint head.
Replay instead compares its predecessor against the original receipt's
`checkpointRevision - 1`, even after later checkpoints have advanced the head.
Reusing an ID with a changed delta or predecessor rejects with
`TURN_SUMMARY_CHECKPOINT_ID_REUSED` before mutation. The receipt's payload hash
continues to describe the ordered message facts; its revision supplies the
predecessor evidence, without a duplicate persisted predecessor field.

Checkpoint revisions and receipt counts are non-negative safe integers; receipt
revisions start at one. A request predecessor must be below
`Number.MAX_SAFE_INTEGER` so its successor remains exact. Revision exhaustion
rejects as `TURN_SUMMARY_CHECKPOINT_REQUEST_INVALID` at request admission.
Both storage readers consume the shared state validation contract.

The checkpoint request contains transaction facts only. The calling Session
service uses persistence context and submission state as runtime options;
neither is part of the request, digest, or persisted evidence.

Replay validates lifecycle and checkpoint ownership before returning the original
receipt. Turn completion or admission of a later turn does not invalidate that
receipt. Terminal persistence and active-turn restrictions apply to new commits.
A session transaction containing only acknowledged checkpoint changes returns
without publishing a generation or updating session timestamps. A transaction
that also contains fresh changes still publishes those changes atomically.
