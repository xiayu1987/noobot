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

## Session changes submission lifecycle

`createSessionChangesSubmission()` owns one submission attempt and its retries.
Its first successful preparation snapshots and freezes the complete request,
including `expectedGeneration`, `operationId`, `changes` and `committedAt`.
Concurrent callers share the in-flight preparation and commit. A failed commit
keeps that exact request; retry must not regenerate its identity, timestamp or
payload from later pending work. Failed preparation leaves no prepared request.

The producer retains the submission until it has validated the authoritative
receipts and acknowledged only the captured message revisions. Work admitted
after capture belongs to a subsequent submission. Storage owns the durable
operation receipt and checks replay before rejecting a stale generation.
The submission object itself is in memory: this contract does not persist an
unacknowledged producer request across process termination. Cross-process retry
requires the original request to be retained by its owning producer.

## Historical operation retry

An operation receipt may carry `retryUnavailable: "original-input-unavailable"`
when an explicit migration cannot prove the complete current checkpoint result
from retained original input. Migration retains the original result, digest,
generation and commit evidence; it never reconstructs request order from mutations.
The operation ID remains reserved permanently. Both transaction entry points reject
it with `SESSION_OPERATION_RETRY_UNAVAILABLE` before generation or input-conflict
handling, without preparing, projecting or executing business changes.

Missing input (no provider or a null/undefined response) produces this explicit
terminal receipt state. Invalid supplied evidence and provider failures still fail
migration. Verified input permits normal result migration and replay. An unavailable
receipt is not later reinterpreted or reconstructed by routine startup migration.
New operation IDs continue through the single current commit protocol. Producers
must not automatically replace an unavailable operation ID to retry the same work.

## Partition journal snapshot ownership

Acquire and reconcile snapshot retentions under the journal publication lock.
A retained snapshot holds its slot's OS descriptor lock until its reads have
drained and the retention is released. The lock sidecar and the replaceable
retention record are separate: never replace or remove a slot's sidecar while
the journal exists, so every process locks the same inode. A retention record
without a sidecar is corruption, not an invitation to create a new lock.

Before publishing a retention into an empty slot, sync the ownership directory
while holding the slot lock, even when reusing an existing sidecar: its prior
creator may have died before syncing the directory. Sync the retention directory
before assigning a slot and after recovery: an earlier unlink may be visible
without being durable, even to a writer that already had the journal open.

An explicit reader `close()` leaves failed cleanup with the holder, who can retry
using the same reader. `Symbol.asyncDispose` (`await using`) ends the holder's
responsibility even if cleanup fails. Both drain accepted reads before release.
The lifecycle supplies `{ scopeExit }` to the release operation to distinguish
these responsibilities. When abandoning delivery of a reader, use disposal rather
than explicit close and report both the original operation error and any cleanup
error. For partition readers and scoped snapshots, the journal takes over failed
cleanup when there is no remaining holder. A reader returns its journal lease
only after the snapshot is released or failed cleanup is registered with the
still-owned journal. A failed explicit close retains both the snapshot and the
lease. The journal retries transferred cleanup before allocating another snapshot
and before successful retirement; it does not reclaim readers still owned by
callers or retained page cursors. Shutdown closes the page snapshot owner before
retiring journals; if page close fails, shutdown reports the error and a retry
resumes with the owner that still holds the reader.

The resident journal limit counts owned journals, including a journal whose
retirement has not completed. Admission never leases a retiring journal. When
admission needs an idle slot or the same closing journal, it joins retirement
or retries it after a failure. No idle journal at capacity reports
`SESSION_MUTATION_BUSY` (409). A failed retirement during admission reports
`SESSION_JOURNAL_RETIREMENT_FAILED` (503), retains the original cause and keeps
the slot owned. That error describes admission, not the requested journal's
health. If a different journal blocks admission due to corruption, it retains
its corruption error and requires repair; retry alone cannot restore it.
Successful retirement allows admission to resolve authority
again and open a new journal; it does not clear a workspace maintenance gate.
Only successful maintenance of the blocked workspace clears that gate. The
resident limit is not a workspace disk quota.

### Session authority admission

Session absence is established by repository scope lookup under the session
lifecycle lock. A deleted scope reports `SESSION_DELETED`; an unregistered scope
reports `SESSION_NOT_FOUND`. Opening a declared live scope requires its published
partition authority. A missing authority reports `SESSION_STORAGE_CORRUPT`, even
when all journal files have disappeared, and cannot be translated into absence.
Placement discovery (`readPlacement`) can return `null`; opening a reader or
mutating an established scope cannot use discovery to hide missing authority.

Outbox pending reads, delivery attempts, acknowledgements and compaction use the
same locked repository admission as other session mutations. Their negative
results translate only `SESSION_NOT_FOUND` and `SESSION_DELETED` to the matching
reason; storage errors propagate. No separate preflight location check determines
whether an Outbox operation may proceed.

Committed visible messages are the authority for `autoTitle`. Stored metadata
excludes this derived field. Legacy aggregate readers and offline format upgrades
use `projectStoredSessionMetadata` to separate stored facts from derived output.
Session initialization and subsequent session transactions validate prepared
metadata through `assertPartitionSessionMetadataMutations` before journal encoding
or publication. A metadata removal, a foreign session or parent, or an own
`autoTitle` field (including empty or null values) rejects that request with
`SESSION_PUBLICATION_CONTRACT`. The rejection preserves the published head and
allows a corrected preparation to retry the same request; no projection silently
removes invalid fields from a prepared mutation. Initialization and offline import
also validate the original metadata before creating seed mutations; neither strips
an input `autoTitle`. Import sources must expose business metadata separately from
their derived title. Raw collection transactions
remain storage primitives used by offline upgrades, not a session mutation API.
Online metadata changes use `applySessionMetadataCommit`: each transition keeps
the aggregate version or advances it by one and requires a canonical transaction
timestamp. Settings, user metadata results, attachment binding, suffix mutations
and plugin artifact version advances use this same transition. Artifact events
advance the staged version in order, once per accepted event; their `occurredAt`
and event-record `committedAt` do not replace the session transaction timestamp
already staged in `updatedAt`. A later invalid event rejects the entire transaction,
including settings, earlier events and their projections. Offline imports preserve
source metadata rather than applying online transitions.

`readMetadata()` returns business metadata; `readMetadata({ includeAutoTitle: true })`,
full export, display and list readers derive the title within their pinned snapshot.
They select the earliest eligible nonempty visible user message and apply
`resolveSessionAutoTitle` to its bounded content preview. Content changes,
deletion and replacement are therefore reflected in new snapshots; retained
snapshots remain unchanged. No candidate means the field is absent.
`customTitle` is an independent stored setting and takes display precedence.
Partition format 95 requires business metadata without `autoTitle` and a title
candidate ordinal directory, initialized
empty and updated atomically with message creation, content changes and suffix
retirement. It contains only positions of eligible nonempty titles, never title
text. Title readers select its first ordinal, validate the visible message and
read its bounded content preview; they do not scan retained history.
Missing directories, invalid candidates and ownership conflicts fail explicitly.
Offline message import maintains this directory without changing source metadata.
Online readers require format 95. Workspace layout upgrade v47 converts
format 93 journals offline, including their current metadata and title
candidate directory. Other prototype formats require their own upgrade.
Offline import preserves business metadata and original timestamps; importing
messages rebuilds the same indexes as online transactions without advancing
source timestamps. Reconciliation compares business metadata exactly before
publishing authority and separately compares both pinned snapshots' derived titles.
For Immutable sources, the offline migration reader resolves `autoTitle` through
the committed title candidate index in the pinned source snapshot, using the same
title reader as legacy display and export. The migration source exposes
`readAutoTitle()` separately from `readMetadata()`, returning an empty string when
the index has no candidate. Neither side stores a second copy of the title.
Missing or invalid title indexes
require the existing offline index upgrade or fail explicitly; readers never
scan message history to compensate for an invalid index.

### Full branch detail availability

An existing full detail document preserves each branch entry's availability and
original reason. The detail is usable only when every entry is available: a
readable main entry cannot establish that unreadable descendants have no
attachments. `selectSessionDetailBlockingEntry` selects the main failure first,
otherwise the first unreadable entry in document order, or `null` for usable
detail. Fetch caches and detail application use this same decision. Failure is
retryable and does not change session-list availability. This contract does not
establish a consistent cross-session snapshot for retained pages.

### Retained session pages

The absolute page snapshot lifetime starts before opening the reader. No page
may be handed to the transport at or after the deadline, including a final page
or an absent result. Any reader release required before returning the result
consumes that lifetime. In-flight storage operations drain before release.
Idle expiry applies only between reads and cannot extend the absolute lifetime.
For validated HTTP continuation requests, the server releases the supplied
cursor if the connection closes before storage is entered. When storage
returns a page with a continuation, the server retains responsibility until
the response finishes writing. After successful transport the caller owns
continuation or explicit release. Abandoned cursors remain subject to expiry.
The receiving transport releases the requested cursor if a continuation fails.
If the first response is decoded but rejected, it releases the returned cursor,
if present. Releases always use the original request scope. If processing and
release both fail, propagate both errors. The browser and Node HTTP adapters
use `retained-session-page` and `retained-session-page-http` respectively,
including for plugin routes.

Display, display-artifact and thinking-detail consumers validate a continuation
against the previous accepted page, not just against the current request. The previous
page's continuation must identify the same reader, scope and position. The
response must preserve the generation and the page family's snapshot facts:
display scope, aggregate version and statistics for display pages, or the turn
summary for display-artifact pages, or the message count for thinking detail.
Only a request without a cursor can start without a previous page. Thinking
detail rejects a mismatched request before sending it, without taking ownership
of or releasing that cursor. After transport starts, the shared release rules
above apply. Server-side response validation checks the individual page and
does not take client-supplied snapshot facts as authority.

Real display rows and display-artifact tool result messages carry `messageUid`,
`contentReference`, and `contentBytes`, not inline content. The artifact page
reads committed tool metadata and artifact references without reading body
chunks; `maxBytes` bounds the page, not the size of the referenced body.
A consumer uses the reference as
`expectedContentReference` for every body request, including offset zero.
`contentBytes` is the length of the JSON UTF-8 string, including quotes. Body
pages each read the current published snapshot and close it before returning;
they do not consume or prolong a display cursor. A newer snapshot can serve
the same body version, but append or replacement rejects with
`SESSION_MESSAGE_CONTENT_VERSION_CONFLICT` and deletion reports a missing
message. Discard any partial body on failure; reselect the row or artifact before
restarting. A terminal display page releases its reader without preventing a
subsequent read of an unchanged body. The version is not a retention promise.

The plugin service session port uses the same body request and response via
`readMessageContentPage({ userId, authoritySessionId, sessionId, segments, request, locale })`.
The service resolves `segments` inside the calling plugin's data root. Scoped
detail, display, display-artifact, body and thinking reads check the requested
session and its direct parent against committed metadata on the reader that
serves the request. Scoped snapshot and execution-report requests select the
session by directory and still require its committed direct parent to match.
Initial scoped reader admission serializes with publication of workspace
deletion markers: authority checks and acquisition of the pinned reader are
one admission step. This also covers directory selections whose session ID is
only known after opening the reader. A known deleted parent or selected session
reports `SESSION_DELETED` before opening its directory. With a directory-only
selection under a live parent, a committed child that is marked for deletion
reports `SESSION_DELETED` while its directory can still identify it. Once the
directory is retired, the same selection reports `SESSION_NOT_FOUND`; the reader
does not infer a session ID from a path. Reads recheck deletion
authority before and after reading the page; the admission fence is not held
while reading or retaining a page.
An unpublished session or a target/parent mismatch reports `SESSION_NOT_FOUND`
without reading from another scope. Retained cursors can only be continued or
released under their original selection. A report requires a published session;
a missing report in that session is distinct from an orphan report. Report bytes
are not snapshot-versioned; their session and dialog identity must match the
validated selection. These checks do not establish cross-session artifact ownership.

## Located record relocation

Relocation preserves a committed record's content identity and changes only its
physical location in the newly published snapshot. Every relocation requires
`{ identity, sourceLocation }`, validated by `requireImmutableRelocationSource`.
The transaction resolves the identity from its captured location root and compares
the exact physical reference before reading bytes. A changed source rejects with
`SESSION_RELOCATION_SOURCE_CHANGED`; staged bytes are not a committed source.
Each explicitly relocated identity is a publication root alongside the business
roots. Moving a child must not require rewriting or traversing its unchanged
parents. Ordinary unreachable staged records are still discarded. A failed
transaction publishes no new locator, and readers pinned to the old location
root keep their original physical ranges until their retentions are released.

`compactSessionArtifacts` uses `requireImmutableCompactionRequest` and
`requireImmutableCompactionRecords`. Each batch supplies `operationId`,
`expectedGeneration`, and explicit source records. `IMMUTABLE_COMPACTION_BUDGET`
limits source count to 128 and aggregate source bytes to 1 MiB; copied locator,
commit and receipt pages also consume the existing transaction budget. Duplicate
identities, unknown request fields and missing source evidence reject. Sources in
the captured active append segment reject with `SESSION_COMPACTION_ACTIVE_SEGMENT`.
Sources are rechecked under the canonical session lock, together with writability,
generation and publication. No source file is removed by relocation.

Batch results use `requireImmutableCompactionResult`:
`{ relocatedRecords, conflicts }`, where every conflict is exactly
`{ identity, sourceLocation, currentLocation }`. A changed source is reported and
does not prevent unchanged sources in that batch from moving. The result accounts
for every requested identity exactly once; duplicate, foreign or unchanged
conflict evidence rejects. Even an all-conflict batch publishes its result in the
ordinary receipt, so retry cannot silently change its outcome. Missing locations,
corrupt bytes, cancellation and I/O failures reject the transaction and publish
neither relocation progress nor a receipt. Active-source rejection remains a
batch admission check. Conflict evidence is an observation at that commit, not
authority for a future relocation: callers must inspect the current snapshot
before submitting a new operation for conflicting identities.

The ordinary operation receipt owns retry progress: replaying the same operation
after an uncertain head publication returns its original result and does not
relocate twice. The generation and source checks apply to new operations, after
receipt replay. Reusing an operation with a different input rejects. This is a
bounded explicit relocation batch; automatic source discovery and scheduling are
not provided by this contract. Old segments remain subject to retained-snapshot
cleanup, including locator pages and the active tail.

## Execution log queue budgets

Listener admission uses `executionLogByteBudget()` and the record limits in
`execution-event-index.js`. Pending byte and record accounting includes active
writes. Records are snapshotted at admission. `executionLogBatchWaitBudget()`
reads `time.agent.executionLogBatchWaitMs` (default 150 ms), strictly below the
queue wait budget. A partial batch waits only until its oldest record's deadline;
later admissions do not extend it. Reaching either the record or encoded byte
limit wakes the writer immediately. Each record still fits the batch byte limit.
`flush()` cancels this aggregation wait, drains accepted work including records
admitted during persistence, and waits for source and projection confirmation.
An isolated record persists automatically without requiring a final flush.

`executionLogQueueWaitBudget()` reads `time.agent.executionLogQueueWaitMs`
(default 2000 ms). Queue age uses a monotonic clock and excludes active writes.
At the exact boundary admission remains valid; an overdue queued record causes
new admission to throw `EXECUTION_LOG_BACKPRESSURE_REQUIRED` with an
`EXECUTION_LOG_QUEUE_WAIT_EXCEEDED` cause. At dispatch, overdue accepted batches
still persist once and register the violation at the final `flush()` barrier,
even if no producer attempted another admission. The barrier waits for accepted
work and preserves concurrent write and delivery failures. A reported queue
violation does not mean that the accepted records were rolled back.

This budget bounds admission under backlog; it does not cancel filesystem I/O
or acknowledge unfinished writes. `flush()` continues to wait for in-flight
persistence. Wall-clock log timestamps do not define queue age. Runtime parameter
changes apply to newly constructed listeners.

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

## Storage checkpoint deltas

`compactSessionStorageJournalRecords` validates every input record, including
overwritten records, and retains the last operation for each message UID and
the last explicit order. Replaying this delta on the same checkpoint base
produces the same messages, hashes and positions. A missing order stays missing;
the operation never infers positions or removes tombstones needed by the base.

The writer uses this protocol operation when creating a summary snapshot.
Journal append boundaries, checkpoint receipts, hash-chain verification and
recovery remain unchanged. Existing snapshots use the same record format and
reader; no migration or alternate read path is required.

Checkpoint files own persisted and summarized UID lists. Full session reads use
`hydrateCheckpointReceipts` and return independent mutable list copies. Transaction
turn views use `hydrateCheckpointReceiptReferences`: only identities produced by
`projectCheckpointIdentity` may supply borrowed, deeply frozen UID lists. Receipt
wrappers remain independent; updates replace lists rather than mutate borrowed
values. Both projections verify receipt metadata and any supplied UID lists.
Service results use `copyCheckpointReceiptLists` before exposing a transaction
session: receipt wrappers and authoritative UID lists become caller-owned mutable
copies, while the transaction retains its borrowed references. This operation
copies an already hydrated session; it cannot hydrate an unverified manifest.
Writing validates the receipt against the current verified identity before
omitting the authoritative lists from the manifest. File identity, hash-chain
checks and commit boundaries are identical for both ownership contracts.

Runtime readers reject the previous schema. Existing artifacts must be changed
offline before deploying all components together.

### Applying bounded lifecycle snapshots / 应用有界生命周期快照

`decideTurnLifecycleSnapshotApplication` owns snapshot validation, sequence
admission and comparison of the latest observed window. Consumers persist the
returned detached `observation` only after applying the snapshot successfully.
They replace that observation with the next accepted window; it is not a history
of observed turns. A failed application must leave both runtime state and the
observation unchanged.

`decideTurnLifecycleSnapshotApplication` 统一负责快照校验、序号准入和最近观察窗口的比较。
消费方仅在成功应用快照后保存返回的独立 `observation`，下次接受窗口时替换它，不累积历史轮。
应用失败时，运行态与观察记录都必须保持原状。

The lifecycle sequence versions committed lifecycle facts. Query `commandId`,
`generatedAt`, `unchanged` and `recovery` are not lifecycle revision identity.
A fresh query of the same facts is a duplicate even when those query fields
change. Different terminal limits may return different windows at one sequence.
Common turn and replacement records must agree; active ownership cannot change
without advancing the lifecycle sequence. Thinking completion is an independently
committed immutable timing fact: later observations may add it, omission cannot
erase it, and contradictory timestamps are rejected.

生命周期序号标识已提交的生命周期事实。查询的 `commandId`、`generatedAt`、`unchanged`
和 `recovery` 不属于生命周期版本身份；同样事实的再次查询仍视为重复。不同终态数量限制
可在同一序号返回不同窗口；共同轮及替换记录必须一致，活动轮归属变化必须推进生命周期序号。
思考完成时间是独立提交的不可变耗时事实，可以补充，缺省不能抹除，矛盾时间戳必须拒绝。

Window omission evicts runtime state; it is not deletion evidence and must not
remove persisted messages. Explicit replacement records or mutation projections
carry deletion evidence. The retained snapshot sequence prevents late lifecycle
or transport events from reviving an evicted turn. A later valid query may load
that historical turn again. Query recovery decisions remain the responsibility
of the caller that requested the snapshot; runtime deduplication does not replace
that decision.

窗口中缺少某轮只意味着淘汰其运行态，不构成删除证据，不得删除持久化消息。
明确的替换记录或命令增量投影提供删除证据。保留快照序号以阻止迟到生命周期或传输事件
重新建立已淘汰运行态；之后有效查询仍可重新加载历史轮。查询的恢复决策仍由发起查询的
调用方负责，运行态去重不能替代该决策。

### Execution query ownership / 执行查询归属

Session reader access projects committed placement from storage. A placement
request may specify the session ID for a bound location or provide only
`sessionDir` for discovery within a declared scope. Discovery reads the ID
from the published storage header and validates it against committed metadata.
A journal whose initialization has yet to publish yields no placement. A
damaged header or mismatched committed identity fails the read.

Targets use canonical, non-empty IDs; an omitted selector is empty, not an ID
to trim or coerce. Snapshot and children queries require `executionId`; a tree
query requires `executionId` or `rootExecutionId`. The read service rejects an
invalid target before accessing storage.

`execution.snapshot.get` checks the requested identity. `execution.children.get`
checks that identity and every claim whose `parentExecutionId` names it; it does
not check grandchildren. `execution.tree.get` checks all claims for the selected
root, including the root identity itself. A duplicate within the query's scope
fails with `execution_identity_conflict`, without returning a partial result.
An unavailable participating session fails all three with `execution_query_incomplete`.

Scope discovery is part of the authoritative read. If discovery fails, the service
returns `{ found: false, reason: "execution_query_incomplete", scopeDiscoveryFailure }`;
`scopeDiscoveryFailure` preserves the original `code` and `message`. No session ID
is inferred from a directory name or a damaged header. After discovery succeeds,
session read failures use `unreadableSessions: [{ sessionId, code, message }]` instead.
Neither failure result contains execution data. Unclassified errors without a
canonical code and message propagate unchanged. WebSocket returns a failed command
receipt with `execution_query_incomplete` for either classified failure; diagnostic
details stay in the service result.

Deleted sessions do not participate in execution reads. Before inspecting a managed
directory's storage authority or placement, discovery excludes the exact relative
directories recorded in branch deletion targets whose `nextStage` is `directories`,
including their subtrees. Once directory cleanup is confirmed, the historical target
does not exclude a new session reusing that path. Discovery obtains directory
exclusions and deleted identities from the
same persisted deletion state. A plugin directory name is never a session identity.
Unmarked storage failures remain query failures; cleanup progress does not authorize
ignoring any other directory. Branch deletion planning still discovers committed
relationships and validates overlaps through the deletion protocol.

Physical removal uses the recorded deletion target and the published storage
authority to select the native or migrated journal root. Under its publication
lock, removal checks every existing snapshot ownership sidecar's descriptor lock,
including owners without a published retention record. A live owner returns
`SESSION_MUTATION_BUSY`; missing sidecars for published retentions are corruption.
This check neither creates ownership locks nor decodes `CURRENT`, retention bodies,
or migration journal heads. Corrupt payloads cannot block an already authorized
cleanup, while missing publication locks and filesystem errors still fail explicitly.
After local journal leases and writers drain, removal releases only snapshot locks
whose readers have transferred cleanup to the resident journal. It does so under
the publication lock, without decoding the associated records. A failed lock close
keeps cleanup owned by the journal and prevents rename. If rename fails after the
locks are released, ordinary abandoned-slot recovery reconciles the remaining records.
Normal reads and recovery continue to validate all published storage content.

A relationship selects which **execution IDs** participate, not which ownership
claims count for those IDs. If one claim is selected through the parent or root,
another claim for the same execution ID remains a conflict even if it names a
different parent or root. A conflict for an ID with no selected claim is outside
the query. A bounded locator must therefore support exact identity lookup as
well as direct-parent and root lookup; relationship results alone cannot prove
identity uniqueness. This is an invariant for the planned bounded read path,
not an assertion that the current runtime has a locator or execution cursors.

单点查询只检查目标身份；直接子级查询检查目标及所有指向它的 `parentExecutionId` 声明，
不检查孙级；整树查询检查所选根及属于该根的全部声明。范围内发现重复身份时返回
`execution_identity_conflict`，不返回部分结果。参与查询的会话不可读时，三类查询均返回
`execution_query_incomplete`。

## Immutable storage migration / 不可变存储迁移

The current physical format is `noobot.immutable-session/5`: stable identities
with compact, snapshot-bound locator pages. Version 4 JSON locator pages are
read-only offline inputs. Workspace layout step
`session-immutable-compact-locations-v39` owns the upgrade, including already
installed v38 workspaces; runtime opens never select a backend by reference shape.

Commit index version 4 stores the commit record directly in each generation leaf.
Version 3 scalar wrappers are decoded only by explicit offline migration. Source
audit and historical replay use the source contract, and target audit uses the
direct-index contract before the head is published. Migration preserves generation,
operation digest and retry results, including after failed publication and retry.
Physical-format equality does not skip a required logical-index conversion.

当前物理格式为 v5，定位页采用紧凑编码并绑定快照，v4 JSON 定位页只供离线读取。
工作区 v39 步骤负责升级已安装的 v38 工作区。提交索引 v4 直接保存提交记录，
v3 标量包装只在离线迁移解码；源审计及历史重放遵循旧契约，目标审计遵循新契约，
成功后才发布 head。物理格式相同不能跳过必要的逻辑索引转换。

## Immutable cleanup ownership / 不可变清理计划所有权

`IMMUTABLE_CLEANUP_PLAN` in `immutable-storage` defines one plan directory,
manifest, candidate-page chain and durable execution cursor. The manifest is the
sole publication point. Version 3 admits only the current located storage format;
older sessions require explicit migration. It inventories owned names before capturing the
retained snapshot under the mutation lock. A later located-storage head must
prove the captured commit through its generation index; ordinary descendant
writes cannot revive inventoried orphan segments. Earlier plans reject and must be explicitly disposed, never
upgraded by inference. Retention follows all registered locations, locator pages,
active tails and pinned reader roots. Locator pages are checksum-verified; content
records are not read or audited. A corrupt content record remains retained for
explicit audit and repair. Inventory, candidate and retained-segment index pages
share the plan lifetime. The retention radix index lives in `retentionDirectory`;
pending identities are limited to `chunkEntries` and its scratch segments to
`retentionSegments`. Exceeding this capacity explicitly rejects preparation with
`SESSION_MAINTENANCE_CAPACITY_EXCEEDED`. `retentionState` durably checkpoints the
physical index root, committed segment tail and unique segment count using
`retentionFormat`. Creation explicitly publishes even an empty set; reopening
requires a valid checkpoint. Index data is synchronized before checkpoint
publication. An uncertain publication reloads the authoritative checkpoint before
retrying pending marks; duplicate marks perform no writes. Reopening accounts for
orphan scratch segments against capacity. The marking cursor binds the captured
roots and advances under `maxMarkingPages`; recovery seek reads are reported separately.
`immutable-cleanup-filter` defines the durable input cursor, output chain and pending
candidate batch. `maxFilterEntries` limits each filtering call. Resume the same
`planId` until preparation returns `complete: true` before executing deletion.
Directory inventory capture still has no persistent traversal cursor or per-call bound.
Inventory and candidate chains jointly allocate at most `chunkPages` pages,
`immutable-cleanup-capacity` owns the durable `capacity.json` reservation. It is
created exclusively and cannot be reset by reopening a writer. Capacity is reserved
before page publication and remains occupied after an uncertain publication or
filter-checkpoint failure. Content-addressed retries validate and reuse existing
pages; they do not infer capacity from the committed candidate prefix. Missing or
corrupt reservation records reject preparation.
A failed full-batch retention flush blocks new identities until that batch completes.
Filtering shares index reads for at most `chunkEntries` files per batch.
Capture format 2 owns the explicit `ready` state. A durable `ready: false` inventory
can resume initialization: reuse an existing ownership record, or capture retained
snapshots under the mutation lock if that record has not been published, initialize
filtering and retention, then publish `ready: true`. Marking cannot begin earlier.
A ready capture never recreates missing ownership or checkpoints. Open failures alone
can establish record absence; read and close failures propagate.
Before the first capture checkpoint is durably published, a first-call failure rolls
scratch back. After that boundary, a first-call failure preserves the plan and throws
`SESSION_MAINTENANCE_PREPARATION_INTERRUPTED` with `planId` and the original `cause`
(including capacity errors). Resume or explicitly dispose that plan. Failed resumption
also preserves it. Capture format 1 is rejected, requiring explicit disposal of old
scratch. Rollback attempts removal and parent-directory sync and preserves all failures.
All preparation, resumption, execution and disposal operations for one `planId`
serialize, including initial preparation. Acquire the plan lock before nesting the
session mutation lock. Inventory, marking and filtering do not hold the session
lock; snapshot capture, publication, ownership release, deletion and disposal do.
Lock recovery follows the shared heartbeat lease: process exit does not permit
reclaiming a fresh lease. A wait timeout reports `SESSION_MUTATION_BUSY` and keeps
the plan; retry the same identity after lease expiry. Published-plan release
failure also preserves the plan. Preparation retry completes ownership release
without republishing the manifest or resetting execution progress.

Execution
deletes candidates, synchronizes their parent
directories, then durably replaces the cursor. Cursor publication is the final
storage mutation of that batch. Candidate pages remain owned by the plan through
partial execution, completion and retries; execution never retires them separately.

Explicit disposal removes the entire plan directory and synchronizes its parent,
including retries after removal already succeeded. It does not trust a manifest
or need a readable cursor, so it also disposes corrupt or unpublished scratch.
Hosts must dispose completed and abandoned plans. Scratch size is bounded by the
prepared plan, not by a deletion batch; retaining pages until disposal does not
increase preparation's peak allocation. No additional retirement cursor is needed;
the inventory and complete candidate set both contribute to scratch capacity.

`immutable-storage` 的 `IMMUTABLE_CLEANUP_PLAN` 统一定义计划目录、发布清单、候选页链及
持久化执行游标。v3 仅接受当前定位存储格式，旧会话须先显式迁移。先捕获所属文件名清单，
再在修改锁内固定保留快照；后继 head 必须以代次索引证明原提交为祖先，普通写入不得
收养清单中的孤立段。旧计划明确拒绝并须显式废弃，不推断升级。定位页校验内容哈希，
正文仅按登记位置保留，不执行正文审计；正文损坏仍保留，交由显式审计和修复处理。
保留范围包含全部登记位置、定位页、活动段和读者快照。文件清单页、候选页及保留段索引页共享计划生命周期。
保留段基数索引放在 `retentionDirectory`，待写身份最多为 `chunkEntries`，暂存段最多为
`retentionSegments`；超限以 `SESSION_MAINTENANCE_CAPACITY_EXCEEDED` 明确拒绝准备。
`retentionState` 按 `retentionFormat` 持久化物理索引根、已提交活动尾及去重计数。
创建时显式发布空集合，重新打开必须有有效检查点；先同步索引数据，再发布检查点。
发布结果不确定时重读权威检查点后重试待写标记，重复标记不写入；孤立暂存段也计入恢复容量。
标记游标绑定捕获的保留根，每次最多推进 `maxMarkingPages` 页，恢复定位读取单独计量。
过滤契约持久化输入游标、输出页链和待处理候选批次，每次最多处理 `maxFilterEntries` 项。
须以同一 `planId` 恢复，直到返回 `complete: true` 后才可执行删除；目录清单捕获仍无持久化遍历游标或单次预算。
文件清单和候选页链共用 `chunkPages` 分配上限，发布前预留容量，结果不确定时保留额度。
满批刷盘失败后须先完成原批次才能接纳新增身份；候选过滤以最多 `chunkEntries` 个文件共用索引读取。
捕获格式 2 显式记录 `ready` 状态；持久化的 `ready: false` 清单可继续初始化：复用已发布的所有权记录，
或在记录尚未发布时于修改锁内捕获保留快照，初始化过滤与保留集合后发布 `ready: true`，此前不得开始标记。
已就绪捕获不得重建缺失的所有权或检查点；仅打开失败可判定记录不存在，读取和关闭失败须传播。
首次捕获检查点持久化前，首次调用失败须回滚暂存；此后失败保留计划，抛出含 `planId` 和原始 `cause`
的 `SESSION_MAINTENANCE_PREPARATION_INTERRUPTED`，容量错误也遵循该边界。宿主须恢复或显式废弃计划，
恢复失败同样保留计划。捕获格式 1 明确拒绝，旧暂存须显式废弃。
同计划的首次准备、续跑、执行及废弃串行化，嵌套顺序固定为先计划锁、再会话修改锁。
清单捕获、标记和筛选在会话锁外运行；固定快照、发布、归属释放、删除及废弃持有会话锁。
进程退出后仅在共享心跳租约过期时回收锁；等待超时返回 `SESSION_MUTATION_BUSY` 并保留计划，
调用方租约过期后以同一身份重试。清单发布后仍须完成准备保留根释放；释放失败保留计划，
重试只完成释放，不重发清单、不重置执行游标。回滚逐项尝试删除及父目录同步，并同时保留操作与所有回滚错误。
删除候选并同步父目录后，持久化游标是批次最后一次存储修改。候选页
在部分执行、完成及重试期间均归计划所有，不设置独立的页退役流程。宿主必须显式废弃
完成或放弃的计划：删除整个计划目录并同步父目录；目录已经删除时重试仍须完成同步。
废弃不依赖清单或游标可读，也能处理损坏和未发布的暂存。暂存容量取决于准备出的完整
计划，包含文件清单及候选集合；不另建退役游标。

## Execution-log projection output / 执行日志投影输出

Message diagnostics publish in the same immutable transaction as their changed
messages. Their source identity is `["session.messages", sessionId, sequence]`;
the source sequence is session-wide and the per-turn index links to that source
without copying records. Output acknowledgements and the consumption cursor are
independent: after uncertain cursor publication, replay the same source identities
through destination receipts. Never repeat the message mutation to repair output.

Turn-log queries return execution records in their source order followed by that
turn's message diagnostics in diagnostic source order. These streams have no
shared sequence; optional wall-clock timestamps do not establish cross-stream
causality and must not be used to invent missing ordering. Execution metrics
consume the execution stream; diagnostics retain their message identity.

`execution-log-projection` owns both source cursors and destination acknowledgement
contracts. A source identity is the canonical JSON tuple
`[dialogProcessId, segmentSequence, byteOffset]`. Positions compare numerically
within one turn; missing identities and cross-turn comparisons reject. Source
records remain authoritative. A cursor advances only after explicit `written` or
`skipped` outcomes for every record in its batch; failure never re-appends the
authoritative log. Each catch-up call runs under the session mutation lock and
acknowledges at most one source batch before releasing that lock.

Delivery supplies `{ receiptDirectory }` from the authoritative turn location.
Runtime-events owns destination routing and uses
`executionProjectionReceiptName(destination)` to keep one receipt per destination
inside that turn directory. Receipts survive output rotation and archive removal.
The receipt `{ version: 1, sourceId }` is a high-water acknowledgement of ordered
delivery, not another copy of the log. One receipt range must admit strictly
increasing source identities; gaps belonging to other destination channels are
allowed. Replays at or before a durable receipt produce no additional output.

The pending intent is `{ version: 1, offset, payload, receipts }`, where `payload`
is newline-terminated output and `receipts` contains unique `{ file, sourceId }`
targets. `EXECUTION_PROJECTION_OUTPUT_MAX_RECEIPTS` bounds the target count.
Intents and receipts use the shared `{ payload, checksum }` envelope, strict UTF-8
decoding and `EXECUTION_PROJECTION_OUTPUT_RECORD_BYTES` (32 MiB) encoded-byte
limit. Invalid checksums, unknown fields, duplicate targets, corrupt output and
cross-turn receipts fail explicitly. `executionProjectionPendingReceipts` owns
recovery admission and requires one current receipt observation per intent target.
Missing or older receipts remain unconfirmed. If every receipt covers its target,
the output is already acknowledged: recovery synchronizes the receipt directories
and retires the intent without reading or rewriting output or replacing receipts.
A receipt may be ahead because an intent retired before an uncertain directory
sync can reappear after subsequent delivery or rotation. Recovery must preserve
that advanced acknowledgement. An advanced receipt together with any unconfirmed
target is contradictory and rejects before output mutation.

`executionProjectionOutputEntryBytes` reserves a complete single-entry envelope
using the maximum safe output offset. Summing these reservations bounds a combined
intent, including both JSON escaping layers, receipt targets, checksum and framing.
The transport partitions before this sum or the receipt-count limit is exceeded;
it does not reject individually valid entries because an opportunistic group grew
too large. An individually oversized entry rejects before queue admission or
rotation. Each reservation is computed once; grouping does not repeatedly encode
growing payload prefixes. Ordinary writes and projection writes have separate
acknowledgement contracts and therefore do not share one output intent.

The destination queue serializes recovery, appends and rotation. Publication order
is: persist intent and its directory; verify/complete the output at the intent
boundary and synchronize it while preparing and synchronizing receipt temporary
files; publish receipts only after all preparations and output synchronization
succeed; synchronize their unique directories; retire the intent and synchronize
its directory; acknowledge delivery. Temporary receipts carry no acknowledgement
authority. Preparation drains every started operation even when output or a
temporary receipt fails; failure leaves the durable intent for recovery. Receipt
publication is parallel within the protocol target bound and drains every started
operation before failure propagates. Any surviving intent is completed before
later writes, through the same completion routine as first delivery. Unconfirmed
targets require output verification/completion before receipt publication; covered
targets never move backwards. No recovery
step scans historical output files. The source reader's disposable window is
reused only when its opened-file identity/revision, segment and cursor permit it;
it is never an acknowledgement authority.

执行日志是唯一权威数据；目的端回执仅确认按序投递，源游标仅确认消费位置。意图、
回执、源身份、预算与校验统一由协议定义。恢复失败须阻止后续追加，不得静默跳过损坏
字节或推断成功。运行事件的普通存储保留策略不改变权威日志和回执的保留语义。
