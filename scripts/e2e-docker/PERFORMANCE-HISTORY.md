# Historical session performance investigations

Archived evidence for the former six-turn and separate long-turn scenarios.
Commands, workload descriptions and thresholds below describe historical runs;
they are not the current acceptance procedure. Use [PERFORMANCE.md](./PERFORMANCE.md).

Run from the repository root:

```sh
bash scripts/e2e-docker/run.sh test perf
```

The existing Docker prerequisites and connect-code configuration apply. The command refreshes
`.e2e-workspace`, starts the local MCP service and `noobot-mock-model`, and runs PBE-058 in Chromium.
It uses the real frontend, WebSocket transport, service, Agent, model proxy, tools and persistence.
External model/search upstreams are replaced by deterministic local providers. Production
configuration is not edited. The regular full suite excludes `@perf`.

One Session sends six measured turns after an unmeasured initialization turn. Each measured turn
executes all 18 built-in tools and six character plugin tools six times: 144 calls per turn,
864 in the initial six turns, and 870 main-model requests. After these turns, the same page
runs two stop/continue cycles. Each cycle starts another deterministic tool turn, stops while
its first real interaction card is awaiting input, then immediately submits a new prompt through
the composer. The command must be `turn.continue`, reference the stopped turn, and finish all
144 tool calls, 145 main requests and six summaries in its own scope. Thus completed turns alone
cover 1152 tool calls, 1160 main requests and 48 summaries; the two partial stopped turns add
their observed work. No reload, disk-version polling or artificial settle delay prepares continuation.
The manifest lives in
`../mock-model-service/scenario.mjs`; a registry assertion rejects unclassified new built-in tools.
No built-in tools are excluded. MCP and service calls execute through local services. Model switching
uses a second mock alias. Interaction is answered by Playwright. Search, image generation and image
parsing use local HTTP fixtures; the real provider adapters still run. A test-created SQLite connector
executes a read-only probe. The character plugin uses RobotExpressive.glb and real artifact storage:
generate, read, update and camera operations validate the revision chain. This covers each tool's
representative success path, not every media type, connector provider or plugin input combination.

For ordinary turns, each group of 23 business calls reaches the real `task_summary` threshold.
Continuation restores `turnProgress` from the stopped snapshot under the existing runtime-counter
contract. The stopped interaction has eight successful business calls and one cancelled call;
its snapshot retains `phaseSummaryLoopCount=8`. Therefore the continuation's first summary follows
15 business calls, and subsequent summaries follow every 23 calls. The test derives this offset
from the stopped turn's successful results and checks the complete order, rather than sorting it.
The new mock prompt resets scenario progress, while continuation preserves the runtime counters.
Six required/committed summary pairs per turn are asserted. Summary content preserves the scenario
path, connector and progress so the mock resumes correctly after real context compaction. New user
turns reset progress while Session history accumulates, exercising both forms of context growth.

The mock derives progress from the current turn's tool results, with no shared request counter.
It sends one tool per model response and finishes after the last result. No simulated network delay
is added. Both streaming tool-call deltas and non-streaming responses are supported.

The gate checks successful ordered tool pairs, six samples per tool, 145 main requests per turn,
attempt=1 and six required/committed phase summaries. Auxiliary model calls are counted separately.
Playwright observes acceptance, processing start, first tool, completion and final rendered text
using one worker's `performance.now()`. Acceptance, processing, first-tool and completion timers
now start immediately before the real send-button `locator.click`, after filling the composer.
This includes Playwright actionability, click dispatch, frontend preparation and command transmission;
it is a conservative user-action measurement, not a browser event-handler CPU measurement.
`inputTiming` preserves click-to-command and click-to-visible-completion durations separately.
`uiReadyMs` still measures terminal receipt to final rendered text. Stop timing separately records
click-to-command, click-to-terminal and click-to-UI-ready. Worker timestamps are never subtracted
from browser or server timestamps. These values include browser transport and polling overhead.
Tool durations come directly from server events and are not subtracted from worker timestamps.
Server tool durations use `performance.now()` for successful and rejected executions, so wall-clock
adjustments cannot produce negative durations. Wall-clock timestamps remain available for logs.
These are end-event durations, not an additive execution/framework breakdown.

Turn 1 is the first measured tool turn; turns 2-6 form the warm median. Each warm metric must stay within baseline × 1.3
plus 100ms. The median of turns 5-6 must also stay within the median of turns 2-3 × 1.3 plus 100ms.
The early and late windows do not overlap; turn 4 remains in the overall warm median.
This catches late-session degradation that a whole-run median can hide. Absolute turn and test
timeouts are centralized in `DEVELOPMENT_THRESHOLDS.performance`. A sustained median regression
fails immediately; a single warm outlier can pass the median gate but still faces the absolute
turn limit. Automatic retries and automatic baseline relaxation are disabled.

The two continuation samples are stored separately in `stopContinues`, leaving the six ordinary
rounds and their windows intact. Every continuation metric must individually satisfy both the
existing baseline limit and the early-round growth limit; a slow continuation cannot disappear
inside a six-round median. Stop durations are recorded for diagnosis and subject to the test's
functional timeout; a calibrated stop-latency baseline has not yet been established.
The checked-in baseline predates click-based timing. Its values and tolerances remain unchanged,
so applying it to the wider interval is stricter. Do not attribute a difference against historical
reports to a code regression without accounting for this changed start boundary.

Playwright writes `performance.json` under `test-results/protocol/raw/056-performance-session-*/`.
It includes samples, per-tool events, exclusions, reference values, limits and failures. Browser
protocol and model-invocation attachments provide the diagnostic evidence. A failure preserves
completed samples; failures before a round completes are also recorded in the Playwright trace.
Containers remain available for diagnosis. Clean up with:

```sh
bash scripts/e2e-docker/run.sh down
```

`perf-baseline.json` must match `all-tools-v4` and be calibrated from all six measured turns on
Linux x64 / Node 26.9.0 in Docker; its metadata records cold/warm totals. The previous 13-tool v2
reference is not comparable with this 144-call scenario. The original 2026-11-11 calibration measured
287.497 seconds cold and 297.892 seconds for the warm median. Turns 5-6 were 3.15% slower than
turns 2-3 by median total duration. The complete replay takes approximately 30 minutes.
Checkpoint mean duration increased from 34.5ms in turn 1 to 61.6ms in turn 6; this is an observed
history-growth cost whose code-level cause remains unverified. It is tracked as a gate metric.
Server event timestamp diagnostics identify
model phases for investigation and do not mix with Playwright's monotonic gate clock.
This is a regression reference, not a target for an optimized production Session. Use equivalent
hardware and load for comparisons. When the tool scenario or environment changes, retain the old
report, collect a successful six-turn replay, review all metric changes and update the baseline
in a separate reviewed change. Never accept an unexplained regression by regenerating the baseline.
Optimization should tighten measured reference values. A different tool manifest requires a new
scenario version and a separately measured baseline.

The schema23 verification on 2026-11-11 passed the original baseline and all growth gates without
recalibration. All six turns completed: 864 tool calls, 870 main-model requests and 36 summaries.
Measured turn durations were 61.345, 65.858, 69.402, 72.462, 76.395 and 79.777 seconds.
The warm median fell from 299.873 seconds in the preceding independent replay to 72.462 seconds
(75.84% lower); late total duration grew 15.46% against the early window, within the existing gate.
The preserved report is `test-results/schema23-performance-report.json`; runner status and cleanup
are recorded in `test-results/schema23-performance-status.json`. The isolated test containers stopped.
History growth remains measurable: late processing-start latency was 578.006ms against a 589.743ms
growth limit, and checkpoint mean duration rose from 34.324ms to 50.063ms. Turn-view ownership
validation still materializes historical turns outside the view. Its contribution to these end-to-end
metrics remains unverified; removing identity checks is not an acceptable optimization.

A follow-up replay on 2026-11-11 measured the verified artifact-event journal cache, content-keyed
session tree and tombstone parsing, and single normalization on save. It passed the same baseline:
turn durations were 49.792, 52.455, 55.633, 58.186, 59.741 and 62.196 seconds; the warm median fell
from 72.462 to 58.186 seconds (19.70% lower) and checkpoint mean duration in turn 6 fell from
50.063ms to 39.9ms. Late processing-start latency was 498.5ms against a 523.4ms growth limit, so
history growth in turn acceptance remains the narrowest margin. The report is
`test-results/schema23-journal-cache-performance-report.json`.

A third replay on 2026-11-11 measured checkpoint identity validation moved into the identity
projection, receipt verification without re-serialization, single scoped-path resolution and
command receipt checks without cloning. It passed the same baseline: turn durations were 48.862,
50.528, 53.743, 55.699, 58.003 and 60.719 seconds; the warm median fell from 58.186 to 55.699
seconds (4.27% lower) and checkpoint mean duration in turn 6 fell from 39.9ms to 36.3ms. Late
processing-start latency was 477.3ms against a 495.0ms growth limit; it still grows with history
(273ms in turn 2, 515ms in turn 6) and remains the narrowest margin. The report is
`test-results/schema23-checkpoint-identity-performance-report.json`.

A fourth replay on 2026-11-11 measured validation memoized on immutable values: values passed to
`deepFreeze` are registered, and message normalization, message hashing, artifact-event validation
and completed-turn summary-mark reconciliation reuse their verdict for a registered value. It passed
the same baseline: turn durations were 47.498, 49.016, 51.783, 52.829, 56.342 and 56.842 seconds;
the warm median fell from 55.699 to 52.829 seconds (5.15% lower) and checkpoint mean duration in
turn 6 fell from 36.3ms to 31.8ms. Late processing-start latency was 414.2ms against a 460.5ms
growth limit. Two earlier replays of this change failed the growth gate with sporadic 400-900ms
tool samples; they registered every nested object in the global weak set. Registering only the
value passed to `deepFreeze` removed the spikes, so nested registration must not be reintroduced.
The report is `test-results/schema23-immutable-validation-performance-report.json`.

A fifth replay on 2026-11-11 measured session-level sharing of message positions, link snapshots
and preceding attachments, a shared turn presentation for the list and navigator, and protocol
event counting without projecting full tool details. The public message-item properties remain
unchanged. Stable round membership preserves array identity. With all temporary diagnostics removed,
it passed the original baseline and growth gates: turn durations were 47.552, 48.981, 51.322,
53.072, 56.084 and 57.703 seconds, with 864 tool calls, 870 main-model requests and 36 summaries.
The warm total median was 53.072 seconds, effectively unchanged from 52.829 seconds. Late
processing-start latency fell from 414.2ms to 346.7ms (16.31% lower), against a 441.9ms growth limit.
The report and successful replay/cleanup status are `test-results/frontend-performance-final-report.json`
and `test-results/frontend-performance-final-status.json`.

This shares position and link scans across message items; it does not eliminate history growth.
Processing-start latency still rose from 249.0ms in turn 2 to 365.8ms in turn 6; late acceptance
latency was 176.0ms against a 241.4ms growth limit. Diagnostic CPU samples still show growing
turn-presentation work (approximately 0-18ms) and attachment-reference indexing (0-13ms).
Server-side command receipt to run-configuration timestamps also grew by approximately 50ms
(49-100ms), with roughly 70ms growth through processing submission. These are diagnostic
observations, not additive gate-clock measurements; their remaining code-level causes are unverified.

The reference file is calibrated from the fifth replay above. It remains in the same uncommitted
workspace as the frontend implementation and must be reviewed independently. The old reference is preserved in
`test-results/frontend-performance-baseline-previous.json`. All 30 reference metrics tighten:
warm total 297.892 to 53.072 seconds, processing start 1000.452 to 291.751ms, acceptance 345.002
to 140.804ms and checkpoint mean 53.092 to 29.049ms. Neither the 1.3 multiplier nor the 100ms
allowance nor the independent cross-turn growth check changes. This reference update does not
resolve the remaining growth. An independent six-turn replay must pass before accepting it.

The independent replay passed the tightened reference and all growth gates on 2026-11-11.
It completed 864 tool calls, 870 main-model requests and 36 summaries; turn durations were
47.685, 50.093, 51.958, 53.193, 55.990 and 57.721 seconds. Warm total median was 53.193 seconds,
within the 69.094-second reference limit. Processing-start warm median was 305.8ms against
479.3ms; its late median was 344.0ms against a 430.8ms growth limit. Late acceptance was
106.2ms against a 219.9ms growth limit. The independent result reproduces the lower processing
latency but not an improvement in whole-turn duration. Processing still grew from 238.7ms in
turn 2 to 367.1ms in turn 6, so a passing gate must not be interpreted as constant latency.
The report is `test-results/frontend-baseline-independent-report.json`; replay and cleanup both
exited successfully in `test-results/frontend-baseline-independent-status.json`.

Follow-up on 2026-11-12 moved attachment reference normalization into shared session resources
and retained terminal presentation references when their fields are unchanged. The uninstrumented
`attachment-prefix-final` replay passed the existing tightened reference and growth gates, with
successful replay and cleanup status. Late processing-start latency was 339.9ms versus the prior
independent 344.0ms; the difference is too small to establish an end-to-end benefit. Processing
still grew from 255.6ms in turn 2 to 352.8ms in turn 6. This is not a solution to all history growth.

The synthetic attachment benchmark uses six attachments per assistant message at 6, 24 and 96
turns and checks complete Map entry equivalence with the previous merge-and-index algorithm.
In the latest run its medians were 1.86/16.43/257.62ms before and 0.16/0.39/3.30ms after. These
synthetic costs must not be substituted for replay latency. Disabling terminal reference reuse
in the benchmark changed all 6/24/96 historical references when a new message was added;
enabling it changed none. Rendering time attributable to this reuse has not been measured.
Reports are `test-results/attachment-prefix-microbench.json` and
`test-results/attachment-prefix-microbench-without-reuse.json`.

The proxy also resent every historical channel-state snapshot when the same socket sent another
command. Repeated attachment is now idempotent, preserving its delivery cursor; new subscribers,
live state broadcasts and explicit reconnect baselines retain their existing behavior. The contract
is documented in `agent-transport-protocol/README.md`. At 6/24/96 turns a synthetic repeated
attachment previously emitted 7/25/97 frames (about 1.9/7.0/27.6KB), now zero. Proxy-side median
cost was only 0.017/0.059/0.156ms before; no browser saving can be inferred from this measurement.
Reports are `test-results/subscription-before.json` and `test-results/subscription-after.json`.

The subsequent `subscription-idempotent-final` replay passed the unchanged reference and all
growth gates, covering 864 tool calls, 870 main-model requests and 36 summaries. Replay and
container cleanup both exited with code zero. Turn durations were 49.412, 49.674, 52.039,
53.822, 56.133 and 57.028 seconds; the warm total median of 53.822 seconds remains effectively
unchanged. Late processing-start latency was 322.1ms versus 339.9ms in `attachment-prefix-final`
(5.23% lower in this single replay); the growth ratio was 1.145 versus 1.298. Late acceptance
was 132.4ms, with a growth ratio of 1.026. Processing-start samples still varied from 220.3ms
in turn 2 to 317.8ms in turn 6, with a 342.5ms peak in turn 3. This eliminates redundant
subscription snapshots but does not establish constant latency or attribute all remaining
history growth. Reports are `test-results/subscription-idempotent-final-report.json` and
`test-results/subscription-idempotent-final-status.json`. No baseline or threshold was changed
for either follow-up. Temporary instrumentation was removed; retired diagnostic scripts are
archived under `workspace/admin/runtime/ops_workdir/retired-diagnostics`.

The next investigation split browser-captured frames at acceptance, using the same
Playwright monotonic clock throughout. In `viewer-render-final`, measured turns 2 and 6
spent 89.5/185.8ms from send to acceptance and 133.2/184.1ms from acceptance to
processing. Frame volume remained 13–15 frames and approximately 8.1KB, rather than
growing with history. These windows include transport, scheduling and browser work;
they do not isolate server execution. The full split, including initialization as
round 0, is in `test-results/viewer-render-frame-segments.json`.

CPU diagnostics separately observed accessibility snapshot and trace-capture work,
application JavaScript, native browser work and idle time. Instrumented runs change
the timing and cannot replace an unchanged acceptance replay. Batching transfer
envelopes per turn and reusing each message's validated merge eliminates repeated
merges through the existing semantic-transfer contract. A synthetic 96-turn selector
benchmark improved from 190.0 to 38.9ms; the instrumented replay did not demonstrate
an end-to-end benefit attributable to this change. Conflict rejection, own-message
ordering and nested mutation validation remain covered by regression tests.

The character viewer now schedules frames only while visible playback or recording
requires them, and redraws on camera interaction, resize or replay. Finished cards
stop requesting frames. The unchanged `viewer-render-final` replay passed all gates
with a warm total median of 52.27 seconds versus 53.82 seconds previously, but late
processing was 334.0ms versus 322.1ms, with growth ratio 1.480 versus 1.145. This
scheduler change alone did not improve processing-start growth.

A subsequent six-turn instance diagnostic found that only the resource-panel sample
preview continuously drew before each send. One-second windows contained 61–63
browser commits; original-style mean commit time was 1.34–1.48ms. Layout/paint/style
containment had no repeatable benefit and was not added. The first window's apparent
paint improvement was confounded by initial layout. These draw counts are WebGL draw
calls, not frames. Data is in `test-results/viewer-instance-summary.json`; raw traces
are archived under `workspace/admin/runtime/ops_workdir/retired-diagnostics/viewer-instance`.
Unrequested native-clip playback has been removed: a viewer without an animation
protocol now displays a static model, with orbit and zoom still available. Animation
and capture use the same protocol-driven render loop. This intentionally changes the
resource preview from an implicit looping clip to a static model.

The unchanged `viewer-static-final` replay passed all gates with 864 tool calls,
870 main-model requests and 36 summaries; replay and cleanup exited zero. Warm
total median was 50.78 seconds, late acceptance 86.3ms (growth ratio 0.941), and
late processing 317.0ms (growth ratio 1.441), compared with 334.0ms previously.
This single replay does not establish reduced history growth. Browser acceptance
to processing intervals were 140.8, 133.0, 123.3, 217.6, 232.0 and 229.3ms.
Server lifecycle timestamps gave 154, 149, 136, 169, 207 and 178ms; context
building took 24–40ms and presentation persistence 7–21ms. These server wall-clock
intervals describe different boundaries from browser frame arrivals and must not
be subtracted to infer transport latency. No server phase reproduces the full
browser-side step at turn 4. Evidence is in `test-results/viewer-static-final-report.json`,
`test-results/viewer-static-frame-segments.json` and
`test-results/viewer-static-server-stages.json` (round 0 is initialization).

Two sampled six-turn replays (`static-start-v2-cpu` and `locator-wait-cpu`)
identified measurement overhead in the interaction-card wait. Playwright's
non-array visibility assertion builds an entire-body accessibility snapshot on
each retry when the target is absent. CPU stacks reached
`ariaSnapshotForExpectFailure` through `generateAriaTree`; the corresponding
Playwright server code confirms the missing-target branch. The performance case
now uses `locator.waitFor({ state: "visible" })` with the same selector and timeout.
Visibility, input fill, answer submission and disappearance are still required.
This corrects test observation overhead; it is not an application speedup.

| Measured turn | Send to acceptance before / after (ms) | Acceptance to processing before / after (ms) | Accessibility snapshot CPU before / after (ms) |
| ------------- | -------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| 1             | 53.2 / 45.7                            | 130.2 / 131.5                                | 31.2 / 0                                       |
| 2             | 81.0 / 56.7                            | 134.8 / 132.3                                | 70.4 / 0                                       |
| 3             | 62.9 / 58.9                            | 157.0 / 120.4                                | 54.1 / 0                                       |
| 4             | 128.5 / 64.9                           | 160.3 / 146.6                                | 104.8 / 0                                      |
| 5             | 141.3 / 87.2                           | 162.1 / 175.1                                | 128.5 / 0                                      |
| 6             | 156.8 / 87.9                           | 157.9 / 168.9                                | 135.0 / 0                                      |

These are single before/after replays with identical 250-microsecond CPU sampling.
CPU values are sampled stack residence within the two frame-arrival windows;
subtracting them from wall time does not reconstruct application latency.
The earlier turn-4 step did not recur at the same frame boundary. Accessibility
snapshot residence was zero in all six after windows, but residual growth remains.
Trace DOM snapshots (`captureSnapshot`) still occupied 25.3, 26.1, 28.9, 32.3,
35.0 and 36.5ms of the send-to-acceptance windows. Trace configuration is unchanged.
Acceptance-to-processing windows contained neither type of snapshot after the
change and still rose from 131.5 to 168.9ms. Vue runtime work is distributed across
computed refresh, patching and reactive writes; the `vendor-element-plus` chunk
also contains Vue runtime code and does not identify an Element Plus component.
No specific application component has been established as the remaining cause.
Server-side lifecycle growth recorded above remains a separate observation.

Evidence: `test-results/static-start-v2-profile-summary.json` and
`test-results/locator-wait-profile-summary.json`. Raw profiles and bundled sources
are archived under `workspace/admin/runtime/ops_workdir/static-start-v2-cpu-evidence`
and `workspace/admin/runtime/ops_workdir/locator-wait-cpu-evidence`. Temporary
profiling imports have been removed. Baseline values, growth thresholds and trace
settings were not changed or recalibrated. New measurements must be identified
as using the corrected wait rather than compared as an application speedup.

The unsampled `locator-wait-final` replay passed the unchanged gates with 864 tool
calls, 870 main-model requests and 36 summaries; replay and cleanup exited zero.
Warm total median was 49.87 seconds; late acceptance was 107.2ms and late
processing was 269.5ms (growth ratio 1.288, limit 372.0ms). These values use the
corrected interaction wait and do not establish an application speedup over
earlier replays. Server acceptance-to-processing intervals were 156, 153, 152,
167, 189 and 208ms. Acceptance-to-`session_starting` offsets were 45, 43, 44, 51,
73 and 87ms, placing 42ms of the observed 52ms server growth before initialization
events. This single replay locates an interval, not its code-level cause.
Evidence: `test-results/locator-wait-final-report.json` and
`test-results/locator-wait-final-server-stages.json`.

Two further diagnostic replays (`dispatch-segment-cpu` and
`lifecycle-segment-cpu`) separated lifecycle persistence from event delivery.
Measured processing-start commits stayed near 40–47ms; their pre-callback
segment stayed near 29–34ms rather than growing with history. That segment
includes lock acquisition and writability/scope checks, not just lock waiting.
The coordinator polls at 10ms after an unsuccessful acquisition; a roughly
30ms interval alone does not identify the holder or prove three polling sleeps.
Acceptance saves rose from 6.5ms to about 17ms after the first measured turn,
then stayed mostly flat. Delivery's attempt recording occasionally took
15–18ms, but no compaction event was directly matched to those samples.

A copied-session storage benchmark measured 4- and 7-turn unchanged-view
writes at 4.4ms and 5.5ms. Its first 2-turn case was cold and is excluded from
history comparisons. A separate eight-turn lifecycle benchmark added real
accepted messages and new turns. Excluding its cold first turn, acceptance
took 10–14ms, saving 5–7ms, and session-summary rewriting 0.4–0.6ms. Neither
benchmark reproduced the replay's save-time step. A concurrent append and
processing-start experiment sometimes raised the processing commit to 21–23ms
from about 10ms, without monotonic history growth. Its nested and overlapping
method timers must not be added or interpreted as isolated per-operation
costs. This synthetic contention does not identify the real replay's holder.
Evidence: `test-results/turn-write-segments.json`,
`test-results/lifecycle-storage-segments.json` and
`test-results/lifecycle-concurrent-storage-segments.json`.

Outbox replacement did have a confirmed duplicate operation: replacement
validated the full journal, discarded its projection, then replayed the whole
journal again on the next read. Replacement now retains the validated
projection with the new file identity, byte boundary and detached tail guard.
The projection is constructed from the serialized persisted records, keeping
JSON serialization semantics and isolating it from caller mutations. This
intentionally retains one parse; replacing it with a projection of caller-owned
objects would weaken the disk/cache contract. External replacement and corrupt
logs still invalidate or reject the cache, and appended records continue from
the committed byte boundary.

| Journal records | Old replacement + next read (ms) | Retained projection replacement + next read (ms) |
| --------------- | -------------------------------- | ------------------------------------------------ |
| 1957            | 15.3 + 14.9                      | 18.7 + 1.0                                       |
| 3914            | 25.7 + 27.2                      | 31.1 + 1.0                                       |
| 7828            | 50.8 + 50.8                      | 62.8 + 0.8                                       |

These are five-sample medians on a copied replay journal, without a session
manifest, measuring replacement and projection replay only. At 7828 records
the combined cost fell from 101.6ms to 63.6ms, while replacement alone became
slower because it now also parses detached records. This is a local reduction
in repeated work, not evidence of reduced processing-start latency. Evidence:
`test-results/outbox-compaction-before.json` and
`test-results/outbox-compaction-confirmation.json`. Replacement regression
tests cover caller isolation, incremental append, external file replacement,
corruption rejection and invalid replacement preserving the published state.
The real startup holder and residual browser/server history growth remain
unattributed; no lock timing, trace setting, baseline or gate has been changed.

Both unsampled outbox replays passed the unchanged gates with 864 tool calls,
870 main-model requests and 36 summaries each; replay and cleanup exited zero.
`outbox-projection-final` overlapped quality checks and short benchmarks, so
its 282.2ms late processing median and 52.11-second warm total median are
acceptance evidence, not a controlled speed comparison. Its last measured
turn's server startup offset reached 102ms.

`outbox-projection-independent` ran without concurrent quality checks or
benchmarks. Warm total median was 50.32 seconds, late acceptance 82.2ms
(growth ratio 1.193), and late processing 234.9ms (growth ratio 1.072, limit
384.8ms). Warm processing values were 207.2, 231.1, 220.3, 236.1 and 233.7ms.
Compared with `locator-wait-final`, late processing was 12.8% lower and the
warm total median remained close (49.87 versus 50.32 seconds). These are single
replays; they do not isolate outbox replacement's contribution to startup.
Server acceptance-to-processing intervals were 149, 155, 163, 163, 174 and
169ms; startup offsets were 37, 46, 43, 48, 50 and 53ms. The earlier 102ms spike
did not recur. The remaining 20ms first-to-last server increase is observed
but not attributed to a specific operation. Evidence:
`test-results/outbox-projection-final-report.json`,
`test-results/outbox-projection-independent-report.json` and their
`-server-stages.json` / `-status.json` companions. Related regressions passed
19/19 and protocol/turn-storage tests passed 25/25. No temporary production
timers or profiling imports remain.

### Accepted-run startup read and debug-write measurements

Initialization first obtained `getSessionRunContext` from the session facade, which
validated the accepted turn through the existing canonical turn view and returned
its start timestamp, model alias and resolved session scope. It no longer
materializes every historical message just to read these facts. No repository
read bypass, new cache, fallback or relaxed validation was introduced.

On a replay-session copy with 1, 2, 4 and 7 historical turns, the previous full
read plus scope lookup had warm medians of 0.50, 0.97, 1.93 and 3.38ms; the new
contract measured 0.44, 0.66, 0.99 and 1.30ms. Immediately after accepting a new
turn, the seven-turn sample improved from 4.42 to 1.49ms. This removes an
unnecessary full materialization but does not explain the previously observed
20ms server-side increase. The fixtures trim the manifest while retaining the
original outbox and artifact files; reads were prewarmed before acceptance and
run serially. These measurements do not cover cold startup or lock contention.
Evidence: `test-results/startup-accepted-comparison.json` and
`test-results/startup-read-stable.json`.

The synchronously awaited plugin-config debug write was measured separately,
with the debug switch enabled. Retention is seven days, maximum archives 20,
and the cleanup interval 60 seconds, all from shared thresholds. With 20 matching
archives and 0, 20, 100 and 400 unrelated archives, first-write medians including
cleanup were 0.49, 0.44, 0.58 and 0.94ms; subsequent writes were 0.12–0.17ms.
Unrelated archives incur directory listing and name filtering, not file stats.
In separate synthetic trees with 0, 6, 24 and 96 child sessions, location medians
were 0.09, 0.08, 0.08 and 0.13ms; complete debug writes were 0.19, 0.16, 0.15
and 0.22ms. These serial, small-payload benchmarks do not reproduce concurrent
Agent startup. They do not support changing logging or archive cleanup as a
remedy for the remaining growth. Evidence:
`test-results/plugin-debug-write-bench.json` and
`test-results/plugin-debug-location-bench.json`.

Bot and session regressions passed 643/643, including deleted-session and
wrong-turn/dialog rejection paths. The accepted-context contract is documented
in both agent READMEs; workspace routes still consume `locateSessionScope`.
The roughly 30ms pre-mutation interval and the acceptance-save step remain
unattributed; no lock or persistence changes were made on that evidence.

### Dispatch segmentation and canonical compaction

The completed `dispatch-internal-v2-diagnostic` replay covered 864 tool calls,
870 main-model requests and 36 summaries, with zero replay and cleanup exit
codes. Seven accepted-run dispatch samples were 15.2, 12.6, 12.1, 14.1, 21.0,
18.8 and 21.9ms. Compaction within those samples was 1.7–6.3ms; delivery attempt
recording was 2.9–4.1ms and acknowledgement 3.1–5.6ms. That six-turn replay did
not reproduce the previous roughly 40ms late dispatch spikes. It did not cover
stop/continue; the later eight-turn investigation below establishes synchronous
compaction as a contributor to continuation startup latency.
The earlier `dispatch-internal-diagnostic` replay was aborted because its
temporary instrumentation changed a synchronous clock method into a Promise;
its output is invalid and excluded. Temporary production timers were removed.

Compaction now uses one protocol entry point, `compactAuthorityEventOutbox`,
over canonical entry iterables. The store supplies its validated cached
projection directly, avoiding repeated normalization of the entire outbox.
Raw-array test fixtures explicitly normalize their input; retention boundaries,
consumer delivery rules, ordering and checkpoint persistence remain unchanged.
The final pure-selection benchmark at 489, 979 and 1957 entries measured
1.07→0.09, 1.53→0.11 and 3.05→0.22ms respectively, alternating the old
normalization-plus-filter path and the canonical iterator path for 35 measured
samples. It excludes I/O and does not establish an improvement in processing
start latency. Evidence: `test-results/compaction-canonical-bench.json`.
The obsolete projection-specific script was archived under
`workspace/admin/runtime/ops_workdir/retired-diagnostics`; its earlier result
is historical evidence only.

Serial writer measurements at 2, 4 and 7 historical turns were 3.28, 3.64 and
4.98ms; ownership checks were 0.10, 0.58 and 1.18ms. This small increase does
not reproduce the diagnostic replay's acceptance-save rise from 7.0 to 35.0ms.
The second measured turn's approximately 30ms read spike and the roughly 30ms
processing pre-mutation interval remain unattributed. The snapshot identity
guard is a candidate mechanism, not an established cause. No writer ownership
checks, lock policy, snapshot guard, baseline or threshold were relaxed.
Evidence: `test-results/dispatch-internal-v2-diagnostic-dispatch-segments.json`
and `test-results/writer-history-before.json`. Nested storage timings overlap;
their sum is not the total write time.

The copied seven-turn, 36-snapshot session in
`test-results/snapshot-guard-read-bench.json` reproduced the identity guard's
cache behavior: three recent-copy reads took 295–350ms and read 42 snapshot
payloads each; the first read after the guard took 259.8ms and read 36 payloads.
Subsequent stable reads took 1.4–2.8ms with zero snapshot payload reads. Copying
makes all files recent, unlike the replay where only newly written files are
recent. This confirms the mechanism, not the cause of the second-turn spike;
no guard or verification policy was changed.

The unsampled `compaction-canonical-final` replay passed all unchanged gates,
covering 864 tool calls, 870 main-model requests and 36 summaries. Replay and
cleanup both exited zero. Warm total median was 49.76 seconds; late acceptance
was 95.6ms and late processing 249.6ms (growth ratio 1.145, limit 383.3ms).
Warm processing values were 235.3, 200.6, 245.5, 244.5 and 254.7ms. The previous
independent outbox replay had a 234.9ms late processing median: this replay
does not demonstrate an end-to-end improvement. A roughly one-second agent
regression run overlapped container preparation; no quality checks or
benchmarks overlapped the measured rounds. Evidence:
`test-results/compaction-canonical-final-report.json` and its `-status.json`.
Final regressions passed 177 event-protocol, 96 authoritative-state, 386 service
and 26 agent outbox/turn-storage tests.

The click-based `click-stop-continue-final` replay on 2026-11-12 completed all six
ordinary turns and both stop/continue cycles. Every completed turn passed ordered
tool-pair, request, checkpoint and summary assertions: 1152 tool calls, 1160 main
requests and 48 committed summaries across the eight completed turns, excluding
initialization and the two partial stopped turns. Models used the local mock.
Ordinary total durations were 47.33, 47.35, 48.52, 49.88, 51.76 and 54.30 seconds;
their unchanged baseline and growth gates passed. The overall performance gate
failed on both continuations; this is a detected latency issue, not a passing replay.

| Worker-clock interval (ms)           | Cycle 1 | Cycle 2 |
| ------------------------------------ | ------: | ------: |
| Stop click to command sent           |    92.0 |   104.8 |
| Stop click to stop-completed receipt |   317.1 |   339.5 |
| Stop click to stop button hidden     |   184.7 |   189.6 |
| Continue click to command sent       |   166.0 |   184.1 |
| Continue click to accepted receipt   |   256.9 |   258.5 |
| Continue click to processing receipt |   513.4 |   514.7 |
| Continue click to first tool receipt |   645.0 |   655.6 |
| Continue click to completed receipt  | 55780.3 | 56451.2 |

Continuation processing exceeded the unchanged baseline limit of 479.3ms; first
tool exceeded 629.8ms. All other continuation metrics passed. The early-window
growth limits were 512.3ms and 712.9ms respectively; each continuation is checked
against the stricter of its two limits. The stop button became hidden before
stop-completed receipt in both cycles; the test intentionally submits continuation
without waiting for that receipt or polling disk state. These observations alone
did not identify where the additional continuation cost occurs. Click timings include
Playwright actionability and differ from historical command-start measurements.
No baseline or tolerance was changed. Replay exited 1, cleanup exited 0 and the
isolated containers stopped. Evidence: `test-results/click-stop-continue-final-report.json`
and `test-results/click-stop-continue-final-status.json`.

### Send and continuation dispatch maintenance

The later `send-accept-diagnostic` and `send-dispatch-diagnostic` replays separated
acceptance persistence from event dispatch. Four late stopped/continued acceptance
samples spent 109.9–127.8ms in dispatch, versus 28.3–43.0ms applying the lifecycle
change. Internal dispatch samples identified synchronous outbox compaction;
main-session compactions reached 90–143ms while child sessions took only 3–7ms.
The cost includes rewriting the journal, not just filtering its canonical entries.
Why the old per-connection throttle permitted two compactions only 3.3 seconds
apart remains unverified; a connection change was not established.

Dispatch finishes after delivery and acknowledgement. The initial separate maintenance
module coalesces requests across connections sharing the runtime resolver and runs
compaction after 30 seconds without delivery. It resolves the current Bot when
running, preserves the existing five-minute retention and store locking, records
maintenance failures and retries after another idle interval. The old synchronous
compaction branch and connection-local throttle map were deleted. Temporary
production instrumentation was removed before independent verification.

The unsampled `send-idle-final` replay used the same click-based test, mock models,
six ordinary turns and two immediate stop/continue cycles. All unchanged baseline,
growth and continuation gates passed; replay and cleanup both exited zero.
Completed turns covered 1152 tool calls, 1160 main-model requests and 48 summaries.
No quality checks or benchmarks overlapped the measured replay.

| Continuation interval (ms)  | Before cycle 1 | After cycle 1 | Before cycle 2 | After cycle 2 |
| --------------------------- | -------------: | ------------: | -------------: | ------------: |
| Click to command sent       |          166.0 |         170.4 |          184.1 |         165.4 |
| Click to accepted receipt   |          256.9 |         265.6 |          258.5 |         258.5 |
| Click to processing receipt |          513.4 |         392.7 |          514.7 |         422.2 |
| Click to first tool receipt |          645.0 |         523.7 |          655.6 |         555.4 |
| Click to completed receipt  |        55780.3 |       56722.4 |        56451.2 |       57316.6 |

Processing improved by 120.7 and 92.5ms in this independent before/after pair,
and both continuations returned within the unchanged 479.3ms processing and
629.8ms first-tool limits. Stop terminal receipts were 329.2 and 311.3ms; stop
buttons hid at 186.2 and 167.7ms. This does not establish a stop-latency or total-turn
improvement. Ordinary totals still rose from 45.93 to 54.85 seconds; processing
rose from 309.9 to 389.2ms. The continuation click-to-command interval remains
165–170ms versus ordinary 87–107ms. Browser profiles did not isolate a responsible
application function; Playwright actionability is included in these intervals.

The initial idle scheduling removed maintenance from the synchronous acceptance path;
it did not eliminate journal growth or the linear rewrite cost. At that replay's end,
the main session `ca8a1eef-691d-4bd4-8031-231a00f186e5` still had 10628 journal
records (7733068 bytes), its first sequence and no checkpoint file. No compaction
had completed before inspection: continuous traffic postponed that version's idle deadline.
An already-running compaction can still contend for the store lock. CLI uses an
unreferenced timer and has no maintenance flush on exit; WebSocket and CLI runtime
resolvers have separate scheduling state. The passing latency gate did not resolve
those limitations. The current scheduler instead preserves a fixed 30-second deadline
across deliveries. If a delivery is still active at that deadline, maintenance starts
after it finishes, without waiting another full interval. It never overlaps another
maintenance operation for the same runtime/session. Continuous-delivery, in-flight,
failure-recording and retry tests cover this contract. CLI exit flushing remains
unimplemented; the timer is unreferenced. Exit-time maintenance and crash durability
have not been validated by these latency replays.

Evidence: `test-results/send-idle-final-report.json`, its `-status.json`,
`test-results/send-dispatch-diagnostic-report.json` and the matching diagnostic
log. The prior failed click-based report remains preserved for comparison.

### Acknowledgement planning and local mutation queues

Acknowledgement now plans changes against only the referenced canonical projection
entries. The protocol owns acknowledgement validation, deduplication and delivery
updates; the agent appends only the resulting changed records. The pure in-memory
single-event benchmark (`test-results/acknowledgement-plan-bench.json`) measured
0.023 to 0.004ms at 500 entries, 0.085 to 0.003ms at 2000, and 0.517 to 0.003ms
at 8000. It excludes I/O and other projection copies, and does not establish an
end-to-end improvement.

The `stop-report-diagnostic` replay split stop finalization: listener flush took
27.6/29.8ms, reading 348 execution-log records took 12.6/10.1ms, and saving the
failure report took 1.3/1.1ms. Replacing log line splitting was rejected after an
equivalence benchmark measured 7.93 versus 8.05ms (`test-results/stop-log-read-bench.json`).
Diagnostic logging was removed from all three production files before validation.
The required lifecycle transitions remain unchanged.

Local callers previously entered file-lock election together and polled for release.
The coordinator now queues callers for the same resolved lock path within an instance,
then admits them to file-lock election in FIFO order. Reentrant operations retain
their existing behavior, queued deadlines still reject, expired work cannot execute
later, and failure releases subsequent callers. Cross-process election, heartbeat
and stale-lock reclamation remain enforced. The queue's timeout stays referenced
until admission or rejection so pending mutation callers receive their outcome.

Outbox and execution logs share the module-level session coordinator for
`<sessionDir>.mutation-lock`. Repository instances use a different lifecycle lock
path and their own coordinator. Queueing is scoped to a coordinator instance;
independent instances and processes continue to arbitrate through the file lock.
An eight-contender empty-operation benchmark measured 188.3 to 2.2ms, but used a
25ms polling interval rather than production's 10ms. These isolated numbers must
not be presented as production latency savings.

The independent `local-queue-final` replay and a subsequent `local-queue-control`
replay differed only in whether local callers queued before file-lock election.
Both passed the unchanged gate, using the simulated model, six ordinary turns and
two stop/continue cycles. Total durations in milliseconds were:

| Round | Local queue | Queue removed | Reduction |
| ----- | ----------: | ------------: | --------: |
| 1     |     38089.3 |       46943.9 |    8854.6 |
| 2     |     39944.8 |       46440.5 |    6495.7 |
| 3     |     42319.7 |       48891.5 |    6571.8 |
| 4     |     44622.7 |       51421.7 |    6799.0 |
| 5     |     45805.8 |       52547.3 |    6741.5 |
| 6     |     48916.5 |       53809.8 |    4893.3 |

The sum of tool durations was lower by 1.9–4.2 seconds per round; it does not
account for the full total-duration difference. This is one ordered pair of
replays, supporting a queueing benefit without establishing repeatability or
explaining all of the saved time. Both versions still grew across rounds.
Acceptance, processing and stop timings varied in both directions: there is no
established send-start or stop-latency improvement from this change.

Queued continuation acceptance was 215.4/269.0ms, processing 361.3/414.4ms and
stop completion 331.6/355.8ms. Control acceptance was 267.3/227.2ms, processing
399.4/383.3ms and stop completion 332.4/359.8ms. The second queued acceptance
sample has only 14.0ms of headroom against the unchanged 283.0ms limit.
Browser-local click-to-command measurements for queued continuations were
28.0/31.3ms, versus Playwright-side 140.8/164.4ms. Most of the latter interval is
before the page receives the click; the cause of that difference remains unverified.

Compaction occurred during the queued replay: session
`289a2ea0` had an outbox checkpoint containing sequence floors and a journal of
7786 lines / 5904372 bytes. This establishes maintenance progress during traffic,
but does not establish how many records each compaction removed.

Evidence: `test-results/local-queue-final-report.json`,
`test-results/local-queue-control-report.json` and their status files. The
coordinator used for the control was subsequently reconstructed with the same
queueing contract; it is not byte-identical to the first queued implementation.
Its independent validation is recorded separately as `local-queue-restored`.

The reconstructed coordinator (SHA-256 `c64f91c8fd9f75ea10dd6120ff7de5a836a1ba9782586a8e9d11d6a4f6a53ef1`)
passed that independent replay with no gate failures; replay and cleanup both
exited 0. Ordinary totals were 38887.3, 39995.6, 42476.7, 44077.3, 45013.9 and
47255.0ms. Relative to the queue-removed control, this is 6.4–8.1 seconds lower
per round, reproducing the lower total-duration level without eliminating growth.
The six ordinary turns and two continuations each completed 144 tools, 145 main
model requests and six summaries (1152/1160/48 combined).

Continuation acceptance was 258.3/260.5ms, processing 381.7/418.0ms and first tool
493.1/542.1ms. Second acceptance had 22.5ms of headroom against 283.0ms.
Stop terminal receipts took 357.0/370.8ms; UI readiness took 219.6/178.6ms.
The console's `stopMs` refers to UI readiness, not the terminal receipt; those
values must not be compared as if they measured the same boundary.
This replay establishes neither faster stopping nor removal of per-round growth.
Evidence: `test-results/local-queue-restored-report.json` and its status file.

### Large-history coverage and production report interpretation

The original six-turn replay began without historical message bodies exceeding the
turn-materializer cache budget. It therefore did not exercise repeated historical
materialization after eviction. The same 056 replay now seeds eight summarized,
non-presented historical turns whose committed bytes exceed that budget before
measuring six ordinary turns and two stop/continue cycles. Models remain simulated;
the baseline and thresholds are unchanged. This fixture covers byte-budget pressure,
not the real session's message count or historical checkpoint topology.

The production report for dialog `75d328f4-dc73-4898-91fa-22d6e0b533e9`
contains 294 tool calls. Its 55 file reads averaged 3.1ms execution and 2521.3ms
framework time. The 209 script calls averaged 5686.9ms execution and 2575.3ms
framework time; long tests and explicit waits contribute to script execution.
Framework time includes awaiting the start/end event paths. Checkpoint time sums
`timeline_checkpoint_persisted` spans for current-turn persistence, not just the
tool-result artifact write. These measurements overlap and concurrent tool spans
must not be added to obtain wall-clock duration. Hooks total 1402.1 seconds;
1400.2 seconds belong to `agent.before_llm_call`. Interval attribution identifies
1228.8 seconds overlapping 67 Harness guidance requests (956.4 seconds) and six
summary requests (272.3 seconds). The remaining 171.5 seconds are not attributed.
This overlap identifies awaited auxiliary activity, not tool execution, and does
not explain all hook work. Evidence: `real-report-hook-attribution.json`.

Read-only measurements against this session's 21 turns and 7045 historical messages
found ownership validation through full message materialization took
2680.8/2579.2/2661.0ms across three passes. The derived message-identity projection
took 2611.0ms cold and 3.5/1.5ms warm. It is verified against canonical journal and
checkpoint identities, shares the existing bounded materializer cache, and is not
another persisted authority. This supports ownership materialization as a major
contributor to the approximately 2.5-second checkpoint waits, but is not a live
process attribution of every checkpoint. The real service has not been restarted
with the workspace fixes, so those production reports cannot validate their effect.

Session settings and plugin-artifact queries now use the canonical manifest and
artifact-event projection without materializing historical message bodies. Current
turn identity validation uses the repository turn view instead of a full session.
Real-repository regression tests reject full read/write entry points and remove an
unrelated historical journal to detect accidental historical body dependencies.

| Warm median / continuation samples | Before settings fixes | Settings fixes | Turn identity fix |
| ---------------------------------- | --------------------: | -------------: | ----------------: |
| Processing (ms)                    |                1334.4 |         1339.3 |             828.1 |
| First tool (ms)                    |                1443.3 |         1435.3 |             951.2 |
| Switch model (ms)                  |                1317.3 |           49.1 |                 — |
| Character get (ms)                 |                 564.7 |           70.9 |                 — |
| Camera apply (ms)                  |                 629.6 |          126.8 |                 — |
| Continue accepted (ms)             |           576.9/683.9 |    617.0/671.0 |       676.6/714.3 |
| Continue processing (ms)           |         1766.0/1950.6 |  1853.8/1935.2 |     1365.8/1437.3 |

Both final large-history replays still fail the same eight startup gates. The turn
identity change reduces startup preparation but does not fix continuation acceptance.
Ordinary total time still rises from 49.5 to 59.4 seconds. Full summary checkpoint
transactions can reference historical message UIDs and cannot be replaced with a
current-turn-only view without preserving cross-turn resolution and tool-pair checks.
Evidence: `large-history-settings-final-report.json`,
`large-history-identity-final-report.json` and corresponding status files under
`test-results`. Identity regression passed 748 tests and quality checks passed 49/49.

### Artifact journal incremental replay and remaining growth

`artifact-incremental-final` passed the unchanged baseline and thresholds, with
1152 tool calls, 1160 primary model requests and 48 summaries across six ordinary
turns and two stop/continue cycles. Artifact journal verification reuses parsed
events and per-event byte accounting; protocol validation reuses immutable event
validation. The final ordinary turn fell from 45.7 to 42.2 seconds against
`session-location-restored`; animation tool growth ratios fell from 1.55–1.66 to
1.13–1.20 and task-summary growth from 1.61 to 1.14. This is one replay, not proof
that every real-session path improved.

Warm ordinary totals still rose from 34.8 to 42.2 seconds (gate growth ratio 1.135).
Processing median was 474.4ms against 479.3ms, with a 593.1ms individual sample;
cold acceptance was 1496.7ms. Continuation totals were 42.5/44.9 seconds. Passing
the warm-median gate does not bound every sample or the cold-start latency. The
mock replay does not reproduce real Harness model latency or the exact production
checkpoint topology. Real-service process start was 2026-11-12 20:06:50 +0800,
before these artifact changes; existing production reports cannot evaluate them.

An offline checkpoint probe on the final session measured 29–38ms warm and 2.9s
cold, including 194 snapshot verifications (2.1s, nested within the total). Both
turns used the same complete history, so this does not exclude history growth.
A 134KB manifest comparison found stable reads had no clear benefit from reading
the full manifest on every projection request. Timestamp-churn savings were only
about 1.2ms per read. That experiment was reverted; file identity and the existing
verification guard remain the single cache invalidation rule.

The next measured public cost was full outbox projection copying: 1000 copies
took 6.7/46.3/514.6/1090.7ms for 100/1000/8000/16000 events. This is an in-memory
scaling benchmark, not end-to-end attribution. Batch journal validation now lives
in the event protocol and stages only affected IDs before applying atomically.
The old full-history fork and discarded validation copy are removed. No persisted
state, event identity, sequence or delivery rule is added or inferred. The new
live-container contract is documented in `event-protocol/README.md`; entries
remain immutable. End-to-end benefit must be assessed by a fresh replay.

### Manifest lifecycle and accepted-run reads

Lifecycle snapshots now derive visible turn scopes from the canonical turn order,
without loading historical message bodies. Accepted-run initialization reads its
start timestamp, model alias and resolved scope directly from the canonical
session manifest. It still validates the accepted turn and dialog identity; the
turn-view path's historical checkpoint loading is no longer needed for these facts.
Real-repository tests remove message journals and reject full-history/turn-view
entry points, while covering missing turns, mismatched dialogs and deleted sessions.

The independent, unprofiled `run-context-manifest-acceptance` replay passed every
unchanged gate. Six ordinary turns and two stop/continue cycles completed all
1152 tool calls, 1160 primary model requests and 48 summaries in completed turns.
Replay and environment cleanup both exited zero. Ordinary turn durations were
35.056, 34.315, 34.620, 36.026, 38.014 and 39.686 seconds. Warm processing median
was 458.4ms against the 479.3ms limit; first-tool median was 520.1ms against
629.8ms. Continuation processing was 343.4/344.5ms, and stop-to-UI-ready was
247.4/218.5ms. Related regressions passed 605/605 and quality checks passed 49/49.

The preceding unprofiled `lifecycle-manifest-final` replay failed only processing
median (504.8ms); `lifecycle-startup-profiled` also failed only that gate (488.8ms)
and predates the accepted-run manifest change. Profiling changes execution cost,
so the diagnostic report is not an independent speed comparison. The new passing
replay has 20.9ms of processing-median headroom, not a bound on every startup:
cold processing was 1730.1ms and one warm sample was 571.2ms. Late total duration
still grew 12.7% over the early window, within the existing gate. This mock replay
does not establish real-service or Harness-model latency; the real service was
not restarted for this acceptance. Remaining full-outbox selection paths are
unattributed candidates, not demonstrated causes of these startup measurements.

Evidence: `test-results/run-context-manifest-acceptance-report.json` and its
`-status.json` companion. No baseline or threshold was changed or recalibrated.

Generate a candidate from a complete replay with:

```sh
node scripts/e2e-docker/calibrate-performance.mjs <performance.json> <candidate.json>
```

The command refuses incomplete coverage, tool failures, missing summaries, absolute timeouts and
excessive late-session growth. It creates a new file without overwriting an existing reference.
Review the candidate, preserve the calibration report, then install the reference and run another
complete replay to validate it independently. Calibration against its own samples is not independent
verification. The command never changes the checked-in baseline automatically.

For fast validation without Docker:

```sh
node --test scripts/e2e-docker/*.test.mjs scripts/mock-model-service/*.test.mjs
```
