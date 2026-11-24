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

## Workflow event ownership

Persisted Workflow events belong to the producing session and its accepted turn:
`identity.sessionId` and `identity.turnScopeId` select that authority and its outbox.
For node state events, `payload.nodeSessionId` and `payload.turnScopeId` identify
the child node execution; they do not select the event's storage owner. Both turn
identities must be canonical. Planning and session snapshot payloads retain their
matching envelope turn identity. A node state event cannot create a child turn in
the parent session or bypass the outbox's turn visibility checks.

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

## Plugin artifact projections

`requirePluginArtifactProjection(current, identity)` validates a stored projection
against the requested plugin, artifact type and artifact ID. The projection must
have valid identity tokens, an event ID, object data and a consistent operation
and revision (`created` at revision 1, `replaced` from revision 2). Only `null`
means absent. Validation returns the original value and never repairs missing
fields. Query result construction uses the same contract without an external
identity. Revision conflict decisions remain separate from projection validation.

Immutable lookup and replacement preparation use this contract on the selected
value before returning it or computing its successor. Invalid stored projections
raise a storage integrity error with the protocol error as their cause; a
replacement cannot silently overwrite corruption. Validation needs no additional
storage read or historical scan.

## Outbox acknowledgement integrity

Delivered receipts must carry the exact domain, scope and sequence of their event
envelope. The same protocol rule applies to acknowledgement writes, journal replay,
stored-entry normalization and individual consumer delivery reads. A stored receipt
with valid field types but foreign coordinates is corrupt and raises
`AUTHORITY_OUTBOX_INTEGRITY_INVALID`; it cannot suppress delivery, advance a cursor
or authorize compaction. Normalization checks every consumer in the selected entry.
This validation uses the event already being read and requires no historical scan.

New cursor advances in a transaction share one page budget: the sum of all
`cursor - expectedCursor` ranges cannot exceed the store's outbox page limit
(itself bounded by `AUTHORITY_OUTBOX_PAGE_LIMIT`). Splitting a range across
multiple updates does not increase the budget. An over-budget transaction is
rejected without publishing cursor changes or acknowledgements. Advance in
separate page-sized commits; previously committed receipt replay does not
reapply cursor changes.

## Outbox compaction

`compactAuthorityEventOutbox(entries, { retainDeliveredAfter })` is the single
compaction entry point. It accepts an iterable of canonical outbox entries,
including `projection.entries.values()`. Journal ingestion validates and freezes
entries; external array input must pass `normalizeAuthorityEventOutbox` before
compaction. Compaction does not normalize entries again or mutate its input.
It retains pending deliveries and deliveries at or after the cutoff, preserves
entry order and references, and rejects an invalid cutoff. Persistence and
sequence checkpoint advancement belong to the outbox store.

The result includes `nextRetainedDeliveryAt`: the earliest last-consumer delivery
timestamp among fully delivered entries still protected by retention, or `null`.
An entry with a pending consumer has no retention deadline. Stores propagate this
fact per maintenance page; schedulers retain the earliest deadline across pages
and wake after that timestamp plus their retention duration and one millisecond
(cutoff equality remains protected), even without another delivery. This avoids
polling throughout the retention period. `hasMore` describes scan pagination only.

## Session Outbox availability

Pending reads, delivery attempts, acknowledgements and compaction resolve the
session under its lifecycle lock. An unregistered session returns
`session_not_found`; a deletion marker returns `session_deleted`, including for
requests waiting behind deletion. If a registered session lacks its partition
authority, the operation fails with `SESSION_STORAGE_CORRUPT` rather than an
absence result. These outcomes do not acknowledge delivery or move a cursor.

## Outbox journal transactions

`planAuthorityOutboxJournalRecords(projection, records)` validates a journal batch
without changing its source. Its result contains only the event IDs touched by the
batch and is not a complete outbox. `applyAuthorityOutboxJournalRecords` uses that
plan to advance the supplied projection only after the entire batch validates.
A failed batch leaves entries, prepared events and removal tombstones unchanged.
Commit order, terminal removals and delivery deduplication use the same journal rules.
Planning memory and lookups scale with the batch rather than historical event count.

The store owns a live projection under its session mutation lock; readers must not
treat its Map containers as historical snapshots or mutate them. Appends advance
those containers atomically. Individual canonical entries remain frozen: delivery
changes replace entries, so previously returned entry objects and arrays retain
their values. Journal replacement publishes a new projection. Callers needing an
array use `listAuthorityOutboxProjection`; persistence remains the journal's job.
This replaces the earlier container snapshot behavior and removes the full-history
fork API. Pending selection consumes the projection synchronously. Lifecycle
decisions also read it synchronously under the repository lifecycle lock, before
awaiting the prepare append. Attempts, acknowledgements and compaction hold the
outbox mutation lock. Compaction derives its retained array before journal
replacement. These consumers do not retain containers as asynchronous snapshots.

## Outbox acknowledgement planning

`planAuthorityOutboxAcknowledgements(projection, records)` validates a batch of
acknowledgements using the journal delivery rules. It returns the changed records
and delivery/deduplication counts, or rejects the batch when an event is missing.
It never changes the input projection, including when a later record has invalid
ordering. Repeated acknowledgements in one batch are deduplicated against earlier
records in that batch. Only requested event IDs are read: planning uses memory
proportional to the batch, without copying prepared events or removed-event history.
The caller persists the returned records under the same mutation lock; planning
does not acknowledge delivery durably by itself.

## Guards

`scripts/check-barrel-star-exports.mjs` fails the build when two `export *`
sources in one barrel own the same symbol name, because ESM drops such symbols
silently instead of raising a conflict. The guard resolves each barrel through a
real dynamic import; barrels it cannot load in plain Node are counted as skipped
rather than passing, and `client/noobot-chat/src/public/index.js` is currently
skipped because it re-exports `.vue` modules.
