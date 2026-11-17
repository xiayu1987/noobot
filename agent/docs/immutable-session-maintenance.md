# Immutable session maintenance / 不可变会话存储维护

The runtime authority is the checksummed `head.json` defined by
`@noobot/session-protocol/immutable-storage`. A registered session with a missing,
corrupt, or foreign head is an error. Neither event location nor maintenance uses
`session.json` as a fallback. Old artifacts are inputs to explicit offline
migration only.

运行时权威入口是协议定义并校验的 `head.json`。已注册会话的 head 缺失、损坏或身份不符
均报错；事件定位和维护不回退读取 `session.json`。旧格式仅供显式离线迁移使用。

Ordinary `ImmutableSessionStore.open()` accepts only
`IMMUTABLE_CURRENT_SESSION_FORMAT` (currently `noobot.immutable-session/5`), with
stable record identities, a snapshot-bound location index and committed append
boundaries. Offline code selects a backend explicitly through
`immutableOfflineBackend(format)`; directory presence or reference shape never
selects a backend. The supported offline formats are object storage (v1), sealed
segments (v2, read-only source), append segments (v3), JSON located records (v4,
read-only source), and compact located records (v5).

The workspace upgrade owns format discovery and migration. Layout step
`session-immutable-compact-locations-v39` uses the session immutable-storage upgrade
owner to migrate installed workspaces, upgrade business indexes, and publish the
current format marker. Migration rejects active reader retentions and verifies
the source and translated target before publishing the new head. Source retirement
is retryable: an already published target is verified before retirement resumes,
and failures must not advance the workspace layout version. The object-to-segment
retirement synchronizes the head directory before and after deleting the owned
`objects` directory, including its already absent case on retry. Offline migration
still performs full audits and source retirement without a resumable work budget.

普通打开入口只接受协议的当前格式（目前为 v5）：稳定记录身份、快照绑定的定位索引和
已提交追加边界。离线入口通过 `immutableOfflineBackend(format)` 显式选择 v1 对象、
v2 封存段（只读源）、v3 追加段、v4 JSON 定位记录（只读源）或 v5 紧凑定位记录后端，
不按目录存在性或引用外形猜测格式。工作区 v39 步骤由统一会话存储升级责任方执行迁移、
业务索引升级和当前格式标记发布，已安装 v38 的工作区也必须执行此步骤。
迁移拒绝尚未释放的读者，验证源图与目标图后发布新 head；源文件回收失败可重试，
重试先验证已发布目标，不回退旧图，失败不推进工作区布局版本。对象目录回收前后同步
父目录，重试时目录已不存在仍补做同步。这仍是离线全量迁移，不具备可恢复的逐批预算。

Commit index version 4 maps each generation directly to its authoritative commit
record. Versions 2 and 3 stored a scalar wrapper around that reference. Offline migration
selects the source contract from its explicit metadata header,
audits its wrapped index and historical replay, translates all reachable wrapper
edges and index metadata, then audits the direct-index target before publication.
Version 2 declares command origins only; migration rebuilds current origin indexes
from audited commit mutations rather than inferring them from current entities.
It preserves generations, operation digests and retry results. This conversion
also runs when the physical storage format already matches the target. Runtime
commit queries and retries accept direct references only.

提交索引 v4 将代次直接映射到权威提交记录；v2、v3 的叶值另有一层标量引用包装。离线迁移
依据明确的元数据版本选择源契约，先审计旧索引和历史重放，再转换所有可达包装边及
版本元数据，目标按直接索引契约审计通过后才发布。转换保留代次、操作摘要和重试结果；
即使物理格式已是目标格式也执行。运行时提交查询和重试仅接受直接引用。
v2 源只声明命令来源索引；迁移从已审计的提交变更重建当前来源索引，不从现存实体推断。

Message-source and summary-checkpoint queries use `requireSessionReader` directly.
`findImmutableSessionReader` returns null only when the session scope is absent;
a registered scope always opens its authoritative head, even when the format marker
is absent. A deleted session rejects reader creation. Format-marker existence never
selects a runtime read path or turns a missing head into an absent session.

消息源和摘要检查点查询直接使用 `requireSessionReader`。
`findImmutableSessionReader` 仅在会话作用域不存在时返回空值；已登记作用域即使没有格式
标记也必须读取权威 head，已删除会话拒绝创建读者。格式标记不决定运行时读取路径，
也不能将 head 缺失转换成会话不存在。

Object pages, value bytes and composite metadata use the protocol's
`decodeImmutableJsonBytes`. Invalid UTF-8 or JSON rejects with
`SESSION_IMMUTABLE_STORAGE_INVALID`, the failing reference and original cause;
decoding never replaces malformed bytes. Metadata is validated before accessing
independent content. Value reads assemble already decoded parts directly;
serializing the assembled value belongs only to an explicit byte read.

对象页、值字节及复合元数据统一通过协议解码。非法 UTF-8 或 JSON 明确报告存储损坏，
保留出错引用和原始异常，不以替换字符改变正文。先验证元数据，再访问独立正文；
普通值读取直接组装已解码内容，仅显式字节读取会序列化组装结果。

Bounded file reads own and close their handles through the shared prefix reader.
Read and close failures are both reported, with the read failure as the aggregate's
cause. An absent head, proof state, repair source or offline object is classified
only by the initial open. Reader recovery classifies absence only at its initial
file-type check. Failures after the file was observed never authorize head creation,
proof reset, retention removal, object republication or an empty repair image.
Offline object reads and publication share the same checksum validation.

Cleanup preparation ownership and retained-segment checkpoints follow the same
initial-open boundary. A read or close failure cannot omit a preparation's retained
heads or recreate an empty retained-segment index, even when creation was requested.
The shared handle reader closes each opened file and preserves simultaneous errors.

限长读取统一由共享前缀读取器持有并关闭句柄；读取和关闭同时失败时完整报告两者，并以
读取错误作为 cause。head、退役证明、修复源段及离线对象仅在首次打开时判定不存在；
读者恢复仅在首次文件类型检查时判定记录缺失。文件已被观察到之后发生的错误必须传播，
不能据此创建空 head、重置证明、删除读者保留、重新发布对象或构造空修复段。
离线对象读取与发布复用同一校验入口，不为写入另设宽松读取规则。
清理准备所有权和保留段检查点同样仅在首次打开时判定缺失；读取或关闭失败不能丢弃
准备任务的保留根，也不能因允许创建而重建空保留段索引。打开后的句柄统一关闭，
同时发生的读取与关闭错误完整保留。

## Message mutations and receipts / 消息修改与回执

Summary checkpoints and the independent `userMetaParsedResult` delta read message
metadata and reuse the existing content reference. User-meta merging occurs inside
the owning transaction; the service never reads the complete source message.
Missing sources and ownership or role conflicts reject before head publication.

Ordinary full-message submissions serialize the supplied content, compare block
digests with the previous content's descriptors, and reuse unchanged physical
records. Comparison reads descriptors, never old payloads. Truncation examines only
the overlapping old descriptor paths. This bounds newly written content by changed
blocks, but does not eliminate serialization and hashing of the supplied body.
It is not an append-fragment protocol or a zero-body-work metadata operation.

Explicit `messageContentAppends` carry only new content and the expected committed
content reference. `messageMetadataUpdates` reuse that reference without submitting
the body. The current-turn ledger and persistence projection carry these deltas
through a fixed pending request; acknowledgement validates the durable receipt
before clearing the pending state. Complete new model responses still enter as
new messages. Summary checkpoints return their original committed delta receipt
on first submission and replay; the service does not replace it with a fresh
full-message query.

Message operation receipts contain ordered message identities, validated by
`requireImmutableMessageResult`, rather than message bodies. Response projection
uses those identities and the receipt's original commit mutations while holding
the mutation lock, on both first submission and replay. A later update or removal
does not change the original response. Repeated identities in a batch preserve
response order and project the final committed message for every occurrence;
intermediate superseded bodies are not receipt facts. Invalid receipt identities
or missing committed entities are errors, with no current-head fallback.
Previously persisted body-shaped results are not accepted as identity receipts;
workspace upgrades explicitly enable `migrateMessageReceipts` in the offline graph
migration. `migrateImmutableMessageResult` validates legacy ownership and original
commit membership, preserves order and repeated identities, and removes embedded
bodies. Migration also verifies each original committed entity's ownership before
publishing the audited graph. Current-format sessions with legacy receipts undergo
the same translation; unchanged receipts need no graph rewrite. Operation digests,
generations and other result fields are preserved. Publication failure leaves the
original head authoritative and retryable. Runtime replay accepts identities only.

摘要检查点和独立 `userMetaParsedResult` 增量只读取消息元数据并复用正文引用；user_meta
合并在所属事务内完成，服务不读取完整源消息。源消息缺失、归属或角色冲突在发布 head
之前拒绝。普通整消息提交仍需序列化及哈希输入正文，通过旧描述页的块摘要复用不变的
物理记录，不读取旧正文载荷；缩短正文仅检查重叠范围的描述路径。因此目前消除的是
正文写入放大，不能声称整消息入口已实现元数据修改零正文工作量或片段追加协议。

显式 `messageContentAppends` 只携带新增正文及预期的已提交正文引用；
`messageMetadataUpdates` 复用该引用，不提交正文。当前轮账本与持久化投影通过固定的
待提交请求传递增量，持久回执验证通过后才确认并清除待提交状态。完整的新模型响应
仍按新消息插入。摘要检查点首次提交和重放均返回原提交的增量回执，服务不再用一次
完整消息查询覆盖该回执。

An empty `messageMetadataUpdates[].metadata` confirms the existing message at
`expectedContentReference`. Ownership and content-version checks remain mandatory;
the ordinary transaction publishes and replays its original message receipt without
submitting or reading the body. Persistence projection uses this operation when an
acknowledged message has no field changes, including changes reverted before flush.
Full content assignments still use replacement semantics.

已确认消息没有字段变化时，投影提交空元数据更新，沿同一事务校验归属及正文版本并返回
原提交回执，不再为取得回执而重提整段正文。字段在 flush 前改回原值也遵循该协议。

普通消息操作回执只保存有序消息身份，响应在修改锁内从原提交变更投影；首次提交与
重放共用同一投影入口。后续修改或删除不改变原结果，同批重复身份均返回最终提交值，
不另存被覆盖的中间正文。工作区升级通过 `migrateMessageReceipts` 显式执行离线转换，
协议校验旧消息归属及原提交成员关系，迁移同时验证原提交实体归属。转换保留顺序、
重复身份、操作摘要、代次及其他结果字段，删除内嵌正文；同批重复身份按当前契约返回
该批最终提交值。当前存储格式中残留的旧回执同样转换，没有格式变化时也不跳过；
无须转换则不重写图。新图审计通过才发布，发布失败保留旧 head 并可重试。

Checkpoint receipt migration validates all requested origins in one backward commit-chain
traversal per operation receipt. Each commit is read once, and each matching origin's message
mutation index is built once. Validation uses the nearest checkpoint mutation, rejects a
conflicting or removed origin, and preserves request order without retaining the scanned
history in memory. This avoids multiplying history reads by checkpoint count; the complete
offline migration still has no resumable work budget.

检查点回执迁移按操作回执共享一次提交链回溯；每个提交只读取一次，同一来源提交的消息
变更索引只构建一次。最近的检查点变更是校验依据，冲突或删除不继续寻找更早的匹配值；
结果保留请求顺序，遍历不缓存整条历史。此优化未使整个离线迁移具备可恢复工作预算。

## Inspection / 检查

Value trees use the byte-page contract in `immutable-storage-graph`: leaves hold
at most `IMMUTABLE_VALUE_BLOCK_BYTES`, and branches concatenate left then right
with the exact declared total. New writes split at power-of-two block boundaries;
appending bytes preserves all complete leaf boundaries. Persisted tree balance is
not a read-time rule. The same reader checks decreasing child sizes, remaining
byte budgets and exact subtree totals for normal reads, audit and migration.
Offline migration streams opaque content through this same byte-tree reader and
reblocks it into the current stable layout. It preserves the exact encoded JSON
bytes, including whitespace, escapes and number spelling, rather than decoding
and serializing a complete body. The transfer buffers one content block and a
logarithmic tree fringe, in addition to the bounded segment writer. Its source
and target audits still decode individual JSON values in full; the translation
map and audit visited sets still grow with the retained graph. This does not make
the complete offline migration a bounded or resumable maintenance operation.

正文树由协议定义：叶节点不超过块上限，分支按左右顺序拼接并严格校验总字节数。
新写入在二次幂块边界切分，追加字节不会移动已完整块的边界。读取不推断树的平衡方式，
统一验证子节点严格缩小、剩余字节预算及子树总量；普通读取、审计和迁移共用此契约。
离线迁移通过同一字节树读取器流式搬运不透明正文，按稳定块布局重组，保留原始 JSON
字节（包括空白、转义和数字写法），不再将完整正文解码后重新序列化。搬运额外缓冲为
一个正文块及对数规模的树边界，段写入器仍受既有预算约束。迁移前后审计仍需完整解码
单个 JSON 值，翻译映射及审计访问集合仍随保留图增长；整个离线迁移尚未实现工作预算
及中断续跑。

`inspectSessionArtifacts({ storageService, sessionDir, signal })` leaves committed
objects and the session head unchanged. Under the canonical mutation lock it
captures the head and retained reader snapshots, publishing independent temporary
retention records before auditing outside the lock. These coordination writes
protect the audit if a reader closes or another cleanup runs concurrently. Records
are released on completion, failure, or cancellation; release failures are reported.
Repair already holds the lock and audits without publishing additional records.
Its `storage` report verifies the pinned head's radix indexes, value blocks,
explicit nested references, retained commit chain, generation index, and
idempotency receipts. It also checks registered execution log segment counts.
`ok` and `complete` distinguish a completed structural audit from an interrupted
traversal caused by corruption; `issues` identifies the failing location.
Cancellation rejects the operation.

All independently acquired audit roots are attempted during release even if one
release fails. One release failure preserves the original error object. An audit
failure and a release failure use the shared storage cleanup contract: both are
reported and the audit failure remains the aggregate's `cause`.

审计结束时会尝试释放全部独立保留根，单个失败不阻止其他根的释放；仅有一个释放错误时
保留原始错误对象。审计与释放同时失败统一使用存储清理契约，同时报告两者，并以审计
错误作为聚合错误的 `cause`。

Storage audit checks cancellation before and after each object read, including
chunks inside a single value and repair overlay reads. Its `batchSize` limits
object reads between event-loop yields, rather than logical values or indexes.
Cancellation rejects with the signal's original reason. An in-flight file read
may finish, but no subsequent object read starts after cancellation is observed.

存储审计在每次对象读取前后检查取消，包括单个值内部的数据块和修复覆盖读取。
`batchSize` 按对象读取次数控制让出执行权的间隔，不按逻辑值或索引数量计批。
取消保留信号原始原因；已开始的文件读取可以结束，观察到取消后不会发起下一次对象读取。

Execution segments are validated record by record using the protocol decoder;
inspection, repair and migration validation retain counts rather than segment
bodies or decoded record arrays. The streaming buffer scales with the largest
record, not the total segment size. Inspection and repair propagate cancellation
through execution index reads and segment streams; cancellation is never reported
as corruption. Repair validates all registered segments before rewriting indexes.

检查不修改已提交对象和 head；在统一修改锁内捕获 head 及读者快照并发布独立保留记录，
然后在锁外审计。原读者关闭或并发回收不会撤销检查所需的保留根。结束、失败、取消均
释放这些记录，释放失败明确报错。修复已持有修改锁，其审计不额外发布记录。
检查验证固定代次的索引、值块、协议声明的嵌套引用、保留的提交链、代次索引
及幂等回执，并核查执行日志段计数。损坏导致遍历中止时报告 `complete: false` 和错误位置；
取消信号直接终止操作。此检查验证存储结构和引用一致性，不替代各业务模块的语义校验。

执行日志通过协议解码器逐条校验，检查、修复和迁移验证只保留计数，不保留整段正文或
全部记录数组；流式缓冲取决于最大单条记录，而非日志段总量。检查与修复的取消信号贯通
日志索引读取和日志流，取消不会被记录为损坏。修复在重写索引前验证全部已登记日志段。

This is an explicit full audit, not a request-path read or background collector.
It traverses retained history, uses a per-audit visited set, and yields between
batches. Work and memory are not constant with history size. `checkedValues`,
`checkedIndexes`, and `checkedCommits` are logical traversal counts. `objectReads`
counts object-read calls, including repair overlays, and excludes retention,
head, lock, and execution-log I/O. Read budgets and signals end with the audit
scope; reusing its store does not retain an earlier audit's interception.

Composite value auditing validates metadata and each distinct content reference
without assembling a complete message. Within one audit, current indexes,
historical mutations and retained reader roots share a set of successfully
validated content identities. Decoded bodies are not cached. A subsequent audit
validates them again, and repair overlays, cancellation and read budgets retain
the same object-read boundary. A single opaque JSON value is still decoded in
full to verify its UTF-8 and JSON representation.

这是显式全量审计，不进入普通请求热路径，也不是后台垃圾回收器。它遍历保留的历史，
以本次审计的访问集合去重并分批让出执行权；总工作量及内存并非与历史规模无关。
`checkedValues`、`checkedIndexes`、`checkedCommits` 是逻辑遍历计数；`objectReads`
统计对象读取调用（含修复覆盖），不含保留记录、head、锁及执行日志 I/O。
预算、取消及读取拦截在审计退出时结束，不影响同一 store 后续操作。

复合值审计分别验证元数据和独立正文，不组装完整消息。同一次审计的当前索引、历史
变更及保留读者根共享已成功验证的正文引用集合，仅保留身份，不缓存解码后的正文；
下次审计重新验证。修复覆盖、取消及读取预算仍在同一对象读取边界执行。单个不透明
JSON 值仍需完整解码以验证 UTF-8 和 JSON 表达。

## Reader lifetime and history / 读者生命周期与历史

Opening an immutable reader pins its captured head under the same mutation lock.
The caller owns `close()` / `Symbol.asyncDispose`: close rejects new operations,
drains accepted operations, and durably releases its retention record. Failed
release can be retried. Acquisition rollback and release share the storage cleanup
contract: removal and directory sync are both attempted, every failure is reported,
and the original operation failure remains the cause when cleanup also fails.
Production callers must close readers in `finally` after
all parallel operations finish. There is no timeout or process-ID liveness rule.
An abandoned record continues to retain its snapshot until explicit recovery.

`inspectSessionArtifactReader({ storageService, sessionDir, format, readerId, signal })`
reads one validated record and returns its retained head and `recordDigest`.
`recoverSessionArtifactReader({ storageService, sessionDir, format, readerId,
expectedRecordDigest, assertSessionWritable, assertReadersStopped, signal })`
rechecks those bytes under the canonical mutation lock and durably releases only
that record. A changed record rejects with `SESSION_READER_RETENTION_CHANGED`.
Both requests require an explicit protocol format accepted by
`immutableOfflineBackend(format)`: `IMMUTABLE_SESSION_FORMAT`,
`IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT`, `IMMUTABLE_SEGMENT_SESSION_FORMAT`, or
`IMMUTABLE_JSON_LOCATED_SESSION_FORMAT`, or `IMMUTABLE_LOCATED_SESSION_FORMAT`.
The declared format must match the head;
recovery never discovers a backend or accepts an injected store. Old-format
recovery releases abandoned retentions before offline migration, without changing
the ordinary runtime's current-format-only open contract.
The host must stop reader admission and drain accepted reads before calling
recovery, keep admission stopped until it settles, and supply
`assertReadersStopped` to verify that condition. This assertion must not attempt
to close readers or acquire the session lock: it runs inside that lock.
Storage cannot infer quiescence, and never expires records by age or PID.
Missing records still require directory synchronization, so retry completes an
unlink whose previous directory sync failed. Corrupt and foreign records remain
intact for explicit repair. Recovery does not change the head or remove segments.

The protocol's reader-retention codec validates the complete encoded envelope
against `IMMUTABLE_READER_RETENTION.recordBytes` on both write and read. Acquisition
rejects an oversized envelope before creating its directory or publishing a record;
the generic cleanup-record envelope limit does not authorize a larger reader record.

Cleanup preserves the current head, explicitly retained snapshots, all commit
records, historical mutation values and their explicit nested references, operation
receipts, and outbox values. Intermediate historical radix pages can be retired
after their readers close. History verification reconstructs intermediate roots
from committed mutations; replay does not require the retired pages on disk.
This does not expire commands or receipts and does not bound total history size.

读者创建时在统一修改锁内固定快照；调用方负责在全部操作（包括并行操作）结束后通过
`finally` 调用 `close()` 或 `Symbol.asyncDispose`。关闭先拒绝新操作、等待已接受操作结束，
再持久化释放保留记录；释放失败可重试。获取回滚及释放统一复用存储清理契约，删除失败
也须尝试目录同步，保留每个错误，同时失败时以原操作错误为 cause。
没有超时过期或根据 PID 猜测存活的规则，
崩溃遗留记录继续保留快照，直到显式恢复。恢复先按 `readerId` 检查并取得字节摘要，
随后以 `expectedRecordDigest` 核对原记录。检查与恢复均须显式声明协议格式（v1、v2、v3、
v4 或 v5），通过统一离线后端映射打开，声明必须匹配 head。旧格式恢复用于解除离线迁移
前遗留的读者保留，不改变普通运行入口仅接受当前格式的约束。
宿主负责提前停止接收读取并排空已有读取，
在恢复结束前维持此状态；锁内的 `assertReadersStopped` 只验证该状态，不能在其中关闭
读者或获取同一锁。恢复复用可写性检查、统一锁、目录同步与重试协议，不改 head。

读者保留记录由协议专用编解码入口统一校验完整信封的
`IMMUTABLE_READER_RETENTION.recordBytes` 上限。超限时创建读者直接报错，发生在创建目录
和发布记录之前；通用清理记录的较大上限不能用于发布读者保留记录。

清理保留当前 head、显式读者快照、全部提交记录、历史变更原值及协议声明的嵌套引用、
操作回执和 outbox 值。读者关闭后允许回收中间历史索引页；校验通过提交变更重建历史根，
命令重放不依赖已退役页。不设置命令或回执有效期，历史总容量仍随记录增长。

Logical eligibility is not physical retirement in v4. The current locator keeps
previously published identities, including intermediate business-index pages
outside the audited retained graph. `physicalReferences()` deliberately retains
every published locator entry, so cleanup cannot release those ranges merely
because an audit did not visit them. Explicit relocation can evacuate their old
segments but also copies obsolete records if they are selected. The explicit
location-retirement operation below proves and publishes removals before physical
cleanup. Candidate discovery and orchestration remain unfinished. Commit history,
historical mutation values and receipts remain required.

v4 的逻辑可退役不等于物理已回收：定位索引尚未删除保留图之外的旧业务索引页身份，
清理会保留所有已发布定位项对应的段。搬迁可以腾空旧段，但若选择这些过时记录也会
一并复制。显式定位退役入口已支持可恢复证明和删除发布；自动发现候选及后台编排仍未
完成。不能直接根据旧审计结果删除可能被后续提交重新引用的身份。

## Location retirement / 定位项退役

`retireSessionArtifactLocations({ storageService, sessionDir, sessionId,
assertSessionWritable, operationId, expectedGeneration, records, maxTasks, signal })`
accepts explicit `{ identity, sourceLocation }` candidates. The
`immutable-record-location` protocol owns request, proof-state and result validation.
One proof owns a session until explicit disposal. Repeating the request advances
its durable queue and visited index; `complete: false` requires another batch.

Each batch holds the canonical mutation lock and traverses references through the
current locator. New head roots are enqueued before further marking. Semantic
reference edges come from `immutable-storage-graph`, including historical commit
mutations and operation receipts; opaque body bytes are never searched for hashes.
The final proof generation and locator removal are checked and published through
the ordinary transaction protocol. Source relocation rejects stale source evidence.
Publication failures replay the original durable receipt with the same operation ID.

Proofs use `noobot.location-retirement/4`. Byte tasks persist the expected byte count
and tree depth; raw tasks persist the expected payload length. Branch children must
be byte pages whose lengths sum to the parent, and composite values may occur only
at value roots. These checks remain mandatory after proof recovery.
Index tasks persist their hexadecimal
hash prefix; title tasks persist their binary position prefix. Traversal validates
each page against that path through the ordinary index and title readers, including
after restart. Task identity includes the full traversal context, so reaching the
same content through a different role or path cannot skip validation.

Earlier proof versions are rejected for execution. Explicit disposal validates
the session, operation ID, expected generation and ordered source records without
interpreting the obsolete traversal progress. A foreign or changed owner is
rejected and its scratch remains intact. No automatic proof conversion runs on
the normal maintenance path.

Proof queue and visited pages append across batches to temporary segments. Protocol
budgets limit candidates to 128, tasks per call to 128 (default 32), each task page
to 32 entries, reference
metadata to 1 MiB per semantic value, and temporary segments to 64. Orphan segment
files count toward capacity. Each batch scans the temporary segment directory
once and rejects existing excess capacity before graph traversal. Before publishing
proof pages it checks the same inventory together with newly staged segments.
Exceeding metadata or segment capacity reports an
explicit error and does not publish a locator removal. These bounds do not promise
a wall-clock bound or convergence under arbitrary concurrent write rates.
Wide reference lists are split before persistence. The state stores the current
page's consumed-task offset; each new page stores its predecessor's offset.
Popping a task advances the cursor without rewriting task pages. Recovery restores
partially consumed parent pages after nested traversal; invalid offsets reject.

`discardSessionArtifactLocationRetirement` accepts the same identifying request
and removes proof scratch after completion or abandonment. Disposal attempts parent
directory synchronization even when removal fails and reports both failures using
the shared storage cleanup contract. Retry completes interrupted disposal. Scratch
is retained until explicit disposal; completed operation receipts remain replayable.

Segment read scopes attempt every descriptor close before reporting release
failures. Operation and release failures use the shared storage cleanup contract:
the original operation failure remains the aggregate's `cause`, a single close
failure preserves its identity, and multiple close failures are reported together.

Retirement only changes the current locator. Old readers retain their old location
roots and bytes. Physical cleanup still protects those roots, all remaining locator
entries, and locator pages. Tests combine retirement, evacuation of the remaining
live records, cleanup while pinned, reader release, and deletion of the old segment;
the original operation receipt remains replayable after physical deletion.

定位退役只接收显式候选，逐批在统一修改锁内推进磁盘队列和访问索引；每批先纳入最新
head，通过协议引用边保留全部提交历史、历史值和回执。证明完成后按原源位置核对并通过
普通事务发布删除，失败可用原操作身份恢复。旧读者继续使用旧定位根，释放前不删除旧段。
证明暂存容量不足明确报错；完成或放弃后显式撤销暂存，删除失败仍尝试目录同步并报告
全部错误。此入口尚不包含候选自动发现、整体维护容量背压或后台调度。

证明采用 `noobot.location-retirement/4`，状态保存当前页消费游标，新页保存前驱页消费游标；
弹出任务仅推进游标，不重写任务页，嵌套遍历恢复后继续消费父页，非法游标明确拒绝。
字节任务保存预期长度及树深度，原始载荷任务保存
预期长度；分支子页必须为字节页且长度之和等于父页，复合值只能位于值根，恢复后仍须校验。
索引任务保存十六进制哈希路径，标题任务保存
二进制位置路径，恢复后仍通过普通读取契约逐页校验。访问身份包含完整遍历上下文，
不能因同一内容已由其他角色或路径访问而跳过校验。旧版证明拒绝执行；显式废弃只核对
会话、操作身份、预期代次及有序源记录，不解释旧遍历进度。归属或请求变化时保留暂存
并报错，正常维护不自动转换旧证明。

## Repair / 修复

`repairSessionArtifacts` retains the session writability gate and canonical
mutation lock. Optional `objectReplacements` is an array of `{ reference, bytes }`,
where `bytes` is a Buffer obtained from a trusted copy of the original object.
Every replacement must match its content hash and block size limit. An overlay
audit must verify the whole retained graph before any replacement is written.
Unreferenced replacements and incomplete repair sets are rejected. Each write is
atomic and durable. The head and generation never change. Repeating a repair is
idempotent; interrupted repair can be retried because every restored object has
exactly its committed identity. Execution segment indexes are repaired from the
registered segments after storage validation.

修复沿用会话可写性检查和统一修改锁。可选 `objectReplacements` 提供可信原始副本的
`{ reference, bytes }`；字节必须匹配对象哈希及块大小限制。写入前使用这些字节覆盖读取，
完成整个保留图的验证；无关对象或不完整修复集合会被拒绝。逐对象原子、持久化恢复，
不修改 head 或代次。重复执行幂等，中断后可重试；不会推断或生成缺失的业务事实。
存储验证通过后，执行日志索引可从已登记日志段重建。

## Record compaction / 记录整理

`compactSessionArtifacts({ storageService, sessionDir, sessionId,
assertSessionWritable, operationId, expectedGeneration, records, signal })`
accepts explicit `{ identity, sourceLocation }` records under the
`immutable-record-location` protocol. The canonical mutation lock covers the
writability gate, source comparison, transaction receipt and head publication.
The batch rejects active-tail sources. Changed locations are reported per source
in `{ relocatedRecords, conflicts }`; unchanged sources still move in the same
transaction. Each conflict includes identity, requested source and observed
current location, under the protocol's result validator. An explicit
`currentLocation: null` means the validated current locator has no entry for that
identity; it does not infer why the entry is absent or recreate it from an old
snapshot. This lets retirement and compaction share a discovered candidate set.
Even an all-conflict
batch commits a receipt to preserve its original outcome on replay. Corruption,
missing segment files, cancellation and I/O errors abort the whole transaction rather
than becoming conflicts. Source count and
bytes use `IMMUTABLE_COMPACTION_BUDGET`; index and receipt writes remain subject
to the ordinary transaction budget. Retrying the same operation after a lost
publication acknowledgement replays its durable receipt without another move.
Relocation changes the locator only and does not delete a source segment.

Tests exercise real segment rollover, publication failures on either side of
head replacement, reopening, unchanged-parent reads, bounded request I/O, and
evacuation followed by cleanup. The old segment remains readable while pinned;
after release a new cleanup plan may reclaim it. Candidate selection is explicit:
there is no automatic discovery, durable preparation cursor or scheduler yet.
The source-byte budget does not claim a wall-clock or total storage-capacity bound.

记录整理已接入显式维护入口，批次、源位置及活动段限制统一由协议定义；复用事务回执
处理发布结果不确定后的重试。搬迁不删除旧段，旧读者释放后由已有清理协议回收。
源位置变化逐项明确返回冲突，不阻止同批其余有效记录搬迁；冲突证据和成功计数一起写入
原事务回执，全部冲突时同样保存结果。调用方只需重新检查冲突项并使用新操作身份提交；
当前定位索引查无此项时以 `currentLocation: null` 明确返回，不推断退役原因，也不从旧
快照恢复该项。定位页损坏、记录损坏、段文件缺失、取消和 I/O 失败仍使整笔事务失败，
不发布部分进度。普通业务读取及定位退役仍严格拒绝所需定位缺失。
目前闭环的是已知源记录的有界搬迁、重试与安全回收；自动选段、准备阶段续跑、容量背压
及调度仍未完成，不能将该入口视为完整后台整理状态机。

## Cleanup boundary / 清理边界

Cleanup has one explicit three-operation contract in
`@noobot/session-protocol/immutable-storage`:

1. `prepareSessionArtifactCleanup({ storageService, sessionDir, assertSessionWritable,
dryRun, signal })` first streams owned file names into checksummed inventory
   pages, then captures retained snapshots under the canonical mutation lock.
   This ordering drains writers that could have allocated inventoried names.
   Outside the lock it walks retained locator roots, verifies locator pages, and
   retains every registered segment plus each active tail. It does not read or
   audit content records. It filters only the captured inventory into
   content-addressed candidate pages. Publication takes the lock,
   checks writability again, and verifies the protocol's snapshot ancestry rule.
   The published manifest is the sole authority for `planId`, head, dry-run mode,
   candidate count, and first page. Preparation owns scratch through retained-root
   release after publication. First-call failure before the first durable capture
   rolls back scratch. Later first-call failure reports the retained `planId` and
   original cause; failed resumption also keeps the plan and its authoritative
   checkpoints for retry or explicit disposal;
   a failed rollback is reported and may leave scratch for explicit disposal.
2. `cleanupSessionArtifacts({ storageService, sessionDir, assertSessionWritable,
planId, maxCandidates, maxRemovals, signal })` takes the canonical lock and
   consumes the durable cursor, including after process restart. Default budgets
   come from `IMMUTABLE_MAINTENANCE_BUDGET`. Each candidate, including an absent
   one, consumes candidate budget; the returned `processed` is cumulative.
   `complete` ends the loop; `limitReached` requests another batch with the same
   plan. Execution performs no retention audit or candidate-directory traversal.
3. `discardSessionArtifactCleanup({ storageService, sessionDir,
assertSessionWritable, planId, signal })` removes plan scratch data under the
   same lock. Call this after completion or when explicitly abandoning a plan.

Preparation, resumption, execution and disposal serialize by `planId`, including
the first preparation call. Nested acquisition always takes the plan lock before
the canonical session mutation lock. Inventory, marking and filtering run outside
the session lock; snapshot capture, publication, retained-root release, deletion
and disposal hold it. Waiting for another operation on the same plan therefore
does not hold the session lock or block ordinary business commits.
Plan locks use the shared coordinator's heartbeat lease and timeout contract.
A process exit does not release its lock immediately: a fresh lease is not reclaimed.
With the default 60-second stale threshold and 30-second wait timeout, an immediate
retry may fail with `SESSION_MUTATION_BUSY`. Keep the same plan identity and retry
after lease expiry; a timeout neither discards the plan nor proves corruption.

Unknown request fields are rejected. `dryRun` belongs to preparation; execution
cannot switch it. Old `maxObjectReads` and `maxDirectoryEntries` cleanup arguments
are rejected rather than silently ignored. `maxObjectReads` remains available on
explicit inspection. Plans use `noobot.immutable-cleanup/3` and admit only the
current located format. Earlier manifests reject without execution and require
explicit disposal and preparation. Older sessions must first be migrated;
cleanup returns `SESSION_MAINTENANCE_MIGRATION_REQUIRED` before allocating scratch.
An unchanged head needs no history lookup. A later head must name a different
commit, and its generation index must prove the captured commit is an ancestor.
An increased generation with an unchanged commit rejects before any history lookup.
Other changes reject
with `SESSION_MAINTENANCE_PLAN_STALE` before deletion. Located writes append to
a retained tail or allocate fresh segment identities; they never adopt an
inventoried orphan. Relocation also writes new physical ranges.

Deletion and directory sync precede cursor publication. A failed sync, failed
cursor publication, or cancellation leaves retryable progress. Recovery syncs
the candidate's parent even if the previous attempt already unlinked its file.
All changed directories are attempted even when one sync fails. An operation
failure and simultaneous cleanup failures are preserved together; a single
failure retains its identity. Any failure before cursor publication leaves the
durable cursor unchanged. Preparation rollback and explicit disposal likewise
attempt parent-directory sync even when recursive removal fails.
Candidate pages follow the protocol's
[plan ownership contract](../../session-protocol/README.md#immutable-cleanup-ownership--不可变清理计划所有权):
they remain until explicit disposal. Cursor publication is the final storage
mutation of a deletion batch; there is no separate page-retirement state to lose
after a crash. Plan record size, checksums, page identities, and candidate paths are validated.
The protocol also checks cursor position, the partial first page, full subsequent
pages, and terminal-page candidate counts before executing that page. A valid
record checksum does not make an inconsistent cursor or candidate count usable.

Candidates are wholly unretained segments and owned UUID temporary replacements of
`head.json`, `immutable-session.format`, and segment files. Their names come from the
same protocol as publication. The manifest reports `retainedSegments`, not a
business-object count. Retained segments, foreign names, directories,
symlinks, and legacy artifacts remain intact. A candidate that changes to a
non-file rejects execution. Historical index retirement follows the reader and
replay retention contract above; historical mutation values, idempotency receipts,
and pending outbox values remain retained.

Preparation validates locator retention only. Corrupt content remains retained
for explicit audit and exact-byte repair. Registered execution-log validation
also belongs to explicit inspection and repair; it is not repeated by each deletion
batch. `objectReads: 0` and `scannedDirectoryEntries: 0` describe candidate
execution, not coordination-lock I/O or preparation work. `historyProofLookups`
counts the separate generation-index query (zero for an unchanged head, one for
an accepted descendant); it does not claim zero index or physical reads.

清理统一为显式准备、分批执行、废弃计划三个入口。准备先持久化所属文件名清单，再在
统一修改锁内固定保留快照，排空可能已分配清单内文件名的写入。锁外遍历保留定位根、
校验定位页并保留所有已登记记录所在段及活动尾段；不读取或审计正文。
仅过滤既有清单形成候选页，清单统计字段为 `retainedSegments`。
发布时复核可写性及协议定义的快照祖先关系；清单是唯一发布点。
执行时复用同一 `planId` 的持久化游标，候选预算为 1 也会推进，进程重启后可以继续。
删除及目录同步完成后才发布游标；失败或取消可以重试，不存在的候选也要完成目录同步。
目录同步逐个尝试，单个失败不阻止其他已变更目录同步；操作失败与清理失败同时保留，
不会互相覆盖。首次捕获检查点持久化后失败保留计划；清单发布后准备保留根释放失败也保留计划，
以同一 `planId` 重试释放，不重发清单或重置删除游标。
准备回滚和显式废弃共用删除及父目录同步流程；回滚失败明确报错，
可能保留需要显式废弃的计划暂存，不能将失败响应当作计划文件必然不存在。
v3 计划仅接受当前定位格式；旧格式在分配暂存前返回 `SESSION_MAINTENANCE_MIGRATION_REQUIRED`，
须先显式迁移。普通后继提交必须使用不同提交身份，并由当前代次索引证明原提交仍为祖先；
相同 head 不查历史，合法后继 head 进行一次历史索引查询。代次增加而提交未变时不查历史并明确拒绝。
旧计划不执行或自动升级。后续写入及搬迁只能写入保留尾部或新段，不能收养清单中的孤立段。
dry-run 独立推进自己的计划，完成或主动放弃后显式废弃计划。
正文损坏由独立审计报告，清理保留其所在段供原始字节修复；执行日志校验由检查及修复入口负责，
不在删除批次重复。
文件清单页、候选页与计划共享生命周期，直到显式废弃时整体删除；持久化游标后不再逐页删除或同步，
避免游标推进后丢失页退役进度。暂存峰值仍是完整准备出的计划容量。

Preparation owns its retained snapshots in the protocol-validated
`staging/maintenance/<planId>/preparation.json` record. This record is published
under the session mutation lock after inventory capture and before locator traversal.
Reader-retention enumeration includes these snapshots, so audit, retirement and
other cleanup plans preserve them after a process exit. Preparation no longer
creates anonymous audit-reader pins. Successful preparation removes and syncs
its ownership record. Failure before the first durable capture rolls back the plan;
later first-call failures retain it and report `SESSION_MAINTENANCE_PREPARATION_INTERRUPTED`
with `planId` and the original `cause`. Resumption failures also retain the plan.
Explicit plan disposal removes abandoned ownership. Corruption and foreign snapshots
block maintenance. This record owns snapshots. Marking and filtering have separate
durable cursors; after receiving a `planId`, callers resume preparation with that
identity until `complete: true`. A published retry does not reset deletion progress.

Capture format 2 records initialization with `ready`. A durable incomplete capture
reuses an existing ownership record; if none was published, it captures snapshots
under the mutation lock after inventory capture. Filtering and retention initialization
precede `ready: true` publication and marking. A ready capture cannot recreate missing
ownership or checkpoints. Only an open-time `ENOENT` establishes optional record absence;
read and close failures propagate. Old capture format 1 requires explicit plan disposal.

Preparation still inventories the complete directory and walks all retained locator
roots. Retained segment identities use a plan-owned disk radix index, with at most
`IMMUTABLE_CLEANUP_PLAN.chunkEntries` pending identities in memory and
`retentionSegments` scratch segments. Capacity exhaustion explicitly rejects
preparation. These pages share plan disposal. The physical index root, committed
tail and unique count are durably checkpointed, including an explicitly created
empty set. Reopening requires a valid checkpoint and counts orphan scratch
segments against capacity. Pending marks retry from the authoritative checkpoint
after uncertain publication; duplicate marks do not write. Preparation still has
one `chunkPages` allocation budget shared by inventory and candidate chains.
The `immutable-cleanup-capacity` protocol owns `capacity.json`; exclusive creation
prevents reset, and reservation precedes page publication. A page or filter-checkpoint
publication failure retains capacity across writer instances and process exit.
Content-addressed retries validate and reuse existing pages without charging them
again or rewriting them. Missing or corrupt capacity records reject resumption.
A failed full-batch retention
flush blocks new identities until that batch completes. Filtering shares index
reads for at most `chunkEntries` files per membership query. `maxFilterEntries`
bounds a filtering call; its durable checkpoint owns input progress, output chain
and the pending batch. Marking persists its captured-root cursor and limits scanned
pages with `maxMarkingPages`; recovery seek reads are reported separately.
Directory inventory capture still scans the complete directory without a durable
traversal cursor or per-call bound.
Full business-graph audit remains an independent operation.
Ordinary current-format descendant commits no longer invalidate preparation or execution.
The contract resumes marking, filtering and deletion batches. Directory capture,
automatic recovery orchestration and a maintenance scheduler remain unfinished,
so the entire maintenance lifecycle is not yet bounded and resumable.
Explicit abandoned-reader recovery and
historical index retirement are supported;
commit history and receipt retirement are not.

准备、续跑、执行及废弃按 `planId` 串行化，首次准备也受计划锁保护。嵌套顺序固定为
先计划锁、再会话修改锁；等待同计划操作时不得持有会话锁。清单捕获、定位标记和筛选在
会话锁外运行，固定快照、发布、释放归属、删除及废弃仍在会话锁内完成。
计划锁复用共享协调器的心跳租约。进程退出不意味着锁立即释放；默认租约过期阈值为
60 秒，等待超时为 30 秒，即时重试可能返回 `SESSION_MUTATION_BUSY`。此时保留同一
计划身份，租约过期后重试，不因等待超时删除计划或认定其损坏。

准备快照由协议定义的 `preparation.json` 唯一持久化归属到 `planId`，在清单捕获后、
定位遍历前于会话修改锁内发布。读者保留枚举统一纳入这些快照，审计、定位退役及其他清理
在准备进程退出后仍保留其段；准备不再创建无法直接归属到计划的审计读者记录。
成功准备删除归属记录并同步目录；首次清单检查点持久化前失败回滚整个计划，之后首次失败保留计划，
以 `SESSION_MAINTENANCE_PREPARATION_INTERRUPTED` 返回 `planId`，原错误保留在 `cause`。
续跑失败同样保留现场，显式废弃才删除整个计划；损坏或异属记录明确拒绝。
捕获格式 2 的 `ready` 唯一标记初始化状态；未就绪时复用已有保留归属，缺失时才在锁内固定快照，
初始化筛选及保留索引后发布就绪，随后才标记。已就绪记录禁止重建缺失保护，旧捕获格式须显式废弃。
跨进程退出、持续写入、搬迁、保留旧字节、显式废弃后回收以及释放与回滚故障已有测试。
该归属记录不是遍历进度，不能据此宣称准备续跑完成。

准备阶段仍遍历完整所属目录与全部保留定位根。保留段身份已改用计划所属的磁盘基数索引，
内存待写集合最多为协议的 `chunkEntries`，暂存段上限为 `retentionSegments`，超限明确拒绝准备。
索引页随计划整体废弃；物理索引根、已提交活动尾及去重计数已有持久化检查点，空集合也显式创建。
重新打开须有有效检查点，孤立暂存段计入容量；发布结果不确定时重读权威状态再重试，重复标记不写入。
文件清单与候选页链共用协议 `chunkPages` 分配上限，发布结果不确定时仍占用预留额度。
满批刷盘失败后，新增身份必须先完成原批次；候选过滤每批最多 `chunkEntries` 个文件，共用索引读取。
定位标记与候选筛选已有独立持久游标，分别受 `maxMarkingPages`、`maxFilterEntries` 约束；
标记恢复的定位读取单独计数。调用方收到 `planId` 后续跑准备，直到 `complete: true` 才执行删除。
容量由独占创建的 `capacity.json` 唯一记录，先预留再写页；检查点失败后跨实例、跨进程仍占额度，
重复内容页须校验后复用，缺失或损坏容量记录明确拒绝。续跑失败保留计划，不自动回滚已返回的归属。
目录捕获尚无持久游标与单批预算，整个后台维护预算尚未闭环。当前格式普通后继提交不再使计划过期。
可续跑目录清单、恢复流程的自动编排及维护调度仍未完成。完整业务图审计由独立入口负责。遗留读者已支持显式恢复，
历史中间索引页已按读者及重放协议
支持退役，提交历史与回执没有退役机制；不能仅因当前 head 不再引用就认定对象为垃圾。

### Directory capture convergence design (not implemented)

The following is the proposed replacement for directory enumeration, not a claim
about the current runtime contract. Its implementation must replace the scan path
and include initialization, upgrade, capacity accounting and crash recovery together.

Verified constraints:

- `immutable-object-garbage.js` enumerates `segments` and the session root with
  `opendir`. It yields execution periodically but does not persist a directory position.
- `ImmutableSegmentBatch.stage` allocates random segment identities.
  `publishSyncedFile` separately allocates random publication temporary names.
  Walking committed references cannot discover all files left by failed publication.
- `captureImmutablePreparationRetention` already takes the canonical session
  mutation lock after inventory capture. This drains writers that could have allocated
  a captured name and fixes the heads that protect committed bytes.
- The existing session immutable-storage upgrade owner handles workspace layout
  upgrades through v39. No inventory upgrade step is registered at this checkpoint.

The proposed authority is a durable segment allocation catalogue. It records
allocated identities, including allocations whose transaction never commits;
the location index continues to own record placement and reader visibility.
Neither structure duplicates the other's facts. The catalogue is required by
the new publication contract; missing or corrupt state must fail explicitly.
Normal reads or cleanup must not rebuild it by scanning directories.

Catalogue publication must precede creation of the corresponding segment or its
temporary file. Reserving an identity durably before materializing bytes makes
both failure outcomes discoverable: an unused reservation may have no file,
while an orphan file always has a reservation. Uncertain reservation publication
must be resolved by reading and validating the authoritative state before retry.
It must not allocate a second identity merely because the previous outcome is unknown.

Random per-commit temporary names require registration on every commit. To avoid
that write amplification, the proposed session publication protocol uses one
deterministic temporary path per publication target, protected by the canonical
session mutation lock. Segment temporary paths derive from the reserved segment
identity; head and format publication have a fixed, bounded set of temporary paths.
This change applies only to session publication targets. Generic immutable-page
publication has different concurrency requirements and must retain its own contract.
An abandoned deterministic temporary file must be explicitly validated and recovered
under the lock before creating the next publication; collisions must not be hidden.

The catalogue must provide bounded immutable pages and an atomic snapshot descriptor.
A capture pins that descriptor and persists its page/entry cursor, output chain and
pending output batch. A call consumes at most the protocol capture-entry budget,
including reservations with absent files; filesystem existence does not advance
the authoritative cursor. Subsequent allocations belong to a later snapshot.
No process-local directory handle, entry count replay, filename sorting or repeated
prefix scan may substitute for this persisted position.

After the pinned catalogue has been consumed, capture acquires the existing session
mutation lock and publishes preparation retention before marking begins. The head
and format temporary slots are handled under that same lock. Cleanup deletion must
also hold it, so an active writer cannot have its temporary file removed. A resumed
capture must retain its original catalogue snapshot and output chain; it must not
silently widen its input to include later allocations.

Catalogue pages have their own storage lifecycle. Captures pin their input pages
until their inventory is durably materialized or explicitly discarded. Catalogue
compaction may discard deleted allocations only after checking current allocation
state and those pins under the same ownership protocol. Limits must account for
current pages, pinned old pages, reservations and uncertain publications. Exhaustion
must apply explicit backpressure before creating unregistered files. An unbounded
allocation journal or a limit on cleanup scratch alone does not satisfy this design.

New-session initialization must publish the empty catalogue before its first segment
allocation. Existing sessions need an explicit upgrade owned by the existing session
immutable-storage upgrade driver. With writers excluded, it inventories recognized
segment files, resolves recognized abandoned publication files, durably publishes and
validates the catalogue, then publishes the upgrade fence. It must preserve all
reader/preparation protection and reject ambiguous files instead of inferring their
ownership. Failure must not advance the workspace layout version. The old runtime
directory-scanning entry is removed when the new contract is activated; it is not a
fallback for sessions missing the catalogue. The exact protocol and layout version
numbers remain unassigned until implementation.

Required evidence before activation:

1. Failure injection before and after reservation, segment creation, rename,
   directory sync and catalogue publication; every surviving owned file remains
   discoverable and committed bytes remain readable.
2. A fresh process resumes capture from each persisted boundary while normal
   writers and relocation continue between calls; no input is omitted or repeated.
3. Per-call counters prove bounded page reads, entries visited and output writes,
   including absent-file reservations. Recovery lookup work is reported separately.
4. Concurrent prepare, resume, discard, catalogue compaction and deletion respect
   snapshot pins and one lock order; cancelled work releases ownership explicitly.
5. New initialization, old-session upgrade, interrupted upgrade and corrupt/missing
   catalogue rejection all pass without a runtime scanning fallback.
6. Small tail appends do not register a fresh random head temporary name or rewrite
   the whole catalogue. Measure added syncs, write amplification and foreground tail
   latency during capture and catalogue compaction before claiming a performance win.
