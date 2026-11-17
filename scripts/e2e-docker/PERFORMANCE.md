# Mixed-session performance acceptance

PBE-058 runs one real browser session with character and Harness enabled. The
versioned workload in `scripts/mock-model-service/performance-contract.mjs` is
shared by the browser, deterministic model provider, coverage audit and calibrator.
Acceptance uses the current versioned workload and generated reports. Previous
measurements and investigations can be retrieved from Git history; rerun the current
workload when comparing performance across revisions.

## Workload and Harness coverage

Twenty naturally completed user turns accumulate in the same session. Turns 10
and 20 each execute 38 groups of 23 load tools (874 calls); the other eighteen
turns execute six groups (138 calls). This totals 4232 successful load calls.
After turn 20, two separate stop/continue cycles validate cancellation and recovery
against the largest accumulated history. Continuations and partial stopped work
are reported separately and do not replace any of the twenty turns.

The load contains seventeen built-in and six character tools. Phase summaries run as
independent model requests, not tools; `task_check` remains. The registry
assertion rejects missing or unclassified built-in tools rather than silently
shrinking the workload. MCP, SQLite, media, search, character artifacts, interaction,
model switching and storage use their existing real adapters with local providers.

Harness planning and planning acceptance are enabled through the public UI. Its
analysis, summary, revision and phase acceptance run at the existing full-mode
system thresholds. The test does not lower or override thresholds. Every completed
turn must demonstrate seven auxiliary model purposes, eleven consumed relay kinds,
planning capture and revisions, summary marking, phase and semantic acceptance,
artifact attachment and review generation. Model attempts must complete without
retry. Unknown auxiliary purposes fail explicitly. Deterministic summaries retain
observed tool identities; the provider does not maintain an independent progress
counter across compaction or continuation.

History preparation uses the public session facade: eight extra history turns,
384 messages and 48 summary checkpoints. The shared `PERF_HISTORY` contract requires
more than 128 MiB of logical message content. Preparation verifies ordered checkpoint
identities, message ownership, summary marking and exact content through the public
query contracts. These turns are preparation, not measured user turns. The report
contains message and checkpoint counts and logical content bytes; content-addressed
deduplication means these bytes do not measure physical disk use or cache pressure.

## Run and inspect

From the repository root, use the existing Docker prerequisites and connect-code
configuration. Production configuration is not changed.

Performance runs first execute the `chromium-perf-single` project. It uses the
same history preparation, tools, six repetitions and Harness assertions as the
first ordinary round. It runs to completion under the existing seven-minute model
test execution limit, preserving the complete sample even when it exceeds 60 seconds.
The strict 60-second performance gate is evaluated after replay and evidence
verification, including preparation. Retries are disabled. The `chromium-perf-multi`
project depends on this project; coverage failure, a total of 60 seconds or more,
or an execution timeout prevents the twenty-round replay from starting.
Both collection and verification use this prerequisite. To run only the prerequisite:

```sh
bash scripts/e2e-docker/run.sh test perf-single
bash scripts/e2e-docker/run.sh down
```

```sh
NOOBOT_E2E_PERF_MODE=collect bash scripts/e2e-docker/run.sh test perf
bash scripts/e2e-docker/run.sh down
```

Collection still fails on incomplete workload, tool or Harness errors, excessive
cross-round growth, long-turn checkpoint growth or absolute local pipeline limits.
It skips only comparison with a calibrated baseline. Verification is the default:

```sh
bash scripts/e2e-docker/run.sh test perf
bash scripts/e2e-docker/run.sh down
```

Reports are written to `test-results/protocol/raw/056-performance-session-*/performance.json`.
Preserve each complete report before the next replay replaces raw artifacts.
Failures preserve completed samples. Always check process exit, connector cleanup
and environment shutdown; a completed round is not a completed acceptance run.

## Timing and gates

Browser-facing timers use the Playwright worker's monotonic clock, starting before
the real locator click. Text entry is excluded; actionability and delivery are
included. Server and model timings have their own monotonic interval contracts;
worker, browser and server clock domains are never subtracted from one another.

The report's `timing.preparationMs` starts before session initialization and ends
after history verification and UI configuration. `timing.totalMs` continues through
the replay and evidence verification. The single-round evaluator requires both
fields, verifies that the total includes preparation and click-to-visible completion,
and applies the strict 60-second limit to the total. `gate.metrics.singleRoundMs`
therefore reports the full workload interval. Fixture setup is additionally covered
by the Playwright test timeout. Failure reports retain elapsed time even when history
preparation fails before a sample exists.

`pipelineLocalMs` is the measured server pipeline envelope minus the union of
external model transport intervals. Main and Harness upstream latency are excluded.
This is elapsed local pipeline time, not CPU time: tools, user-interaction waits
and scheduling are included. Auxiliary preparation/processing remain system costs.
Checkpoint duration is split into queue wait, preparation, append and verification.
Nested intervals must not be summed as independent wall time. The logged `heapMB`
is the Playwright worker heap, not service memory.

The gate compares early and late ordinary windows, the two long turns at equal
load, and each long turn's early/late checkpoint thirds. Every continuation and
stop sample is checked separately after baseline calibration. Tolerances and
absolute limits are defined in `scripts/lib/development-thresholds.mjs`; automatic
retries and baseline relaxation are disabled. Tool, model, checkpoint and Harness
coverage assertions precede performance acceptance.

## Storage projection ownership and budgets

The bounded `head.json` publishes the authoritative immutable object graph, including
radix indexes, messages, checkpoint receipts, operation receipts and commit records.
Readers pin a head generation and resolve selected entities through those indexes.
Objects are verified by content hash when accessed; unrelated history is not scanned
by each normal commit. Full graph integrity checking is an explicit audit operation.

Values use 32 KiB blocks. Multi-block reads validate descriptors and child sizes,
then assemble verified leaves once instead of repeatedly copying ancestor payloads.
Caches and display summaries remain disposable projections, never storage authority.

Targeted regressions cover bounded reads, index updates, checkpoint identity, failed
commits, replay integrity, recovery and object repair durability. These checks do
not replace browser performance acceptance. The authoritative description of
reader retention, location retirement, record compaction, cleanup preparation,
deletion budgets and recovery is
[the maintenance contract](../../agent/docs/immutable-session-maintenance.md).
Explicit bounded retirement and relocation have recovery tests. Cleanup preparation
walks retained locator roots and the owned directory inventory without a resumable
work cursor; it does not audit content records. Automatic candidate discovery,
maintenance orchestration and overall capacity backpressure remain unfinished.
Historical mutation values, commit records, receipts and outbox values remain
retained. Browser performance acceptance on a fixed candidate is still required
before the architecture can be declared complete.

## Baseline calibration

The old `all-tools-v4` baseline does not apply to this workload. Keep it as historical
reference until a new candidate passes independent verification. Do not declare
verification success against a mismatched baseline.

Collect at least three complete final-code replays under the same environment and
configuration, without diagnostic instrumentation or concurrent verification load:

```sh
node scripts/e2e-docker/calibrate-performance.mjs test-results/perf-candidate.json test-results/replay-1.json test-results/replay-2.json test-results/replay-3.json
```

The calibrator requires matching plans, plugins, Harness configuration, metric
coverage and complete stop/continue samples. It refuses failed growth or absolute
gates and creates a new candidate file without overwriting an existing file.
Review the candidate, install it as `perf-baseline.json`, then perform an independent
fourth replay. Calibration against its own samples is not independent verification.
Record code revision/diff, environment, reports, exit/cleanup status and failures.

Current final-code performance acceptance and baseline calibration are pending;
passing targeted storage regressions or historical replays does not close them.

Fast contract checks:

```sh
node scripts/run-with-isolated-tmp.mjs node --test scripts/e2e-docker/*.test.mjs scripts/mock-model-service/*.test.mjs
```
