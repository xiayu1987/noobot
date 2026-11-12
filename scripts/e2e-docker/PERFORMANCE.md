# Session performance gate

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
864 overall, and 870 main-model requests. The manifest lives in
`../mock-model-service/scenario.mjs`; a registry assertion rejects unclassified new built-in tools.
No built-in tools are excluded. MCP and service calls execute through local services. Model switching
uses a second mock alias. Interaction is answered by Playwright. Search, image generation and image
parsing use local HTTP fixtures; the real provider adapters still run. A test-created SQLite connector
executes a read-only probe. The character plugin uses RobotExpressive.glb and real artifact storage:
generate, read, update and camera operations validate the revision chain. This covers each tool's
representative success path, not every media type, connector provider or plugin input combination.

After each group of 23 business calls, the real phase threshold requires `task_summary`.
Six required/committed summary pairs per turn are asserted. Summary content preserves the scenario
path, connector and progress so the mock resumes correctly after real context compaction. New user
turns reset progress while Session history accumulates, exercising both forms of context growth.

The mock derives progress from the current turn's tool results, with no shared request counter.
It sends one tool per model response and finishes after the last result. No simulated network delay
is added. Both streaming tool-call deltas and non-streaming responses are supported.

The gate checks successful ordered tool pairs, six samples per tool, 145 main requests per turn,
attempt=1 and six required/committed phase summaries. Auxiliary model calls are counted separately.
Playwright observes acceptance, processing start, first tool, completion and final rendered text
using one worker's `performance.now()`. These values include browser transport and polling overhead.
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
