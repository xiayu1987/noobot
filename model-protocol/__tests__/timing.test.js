/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeModelPipelineTiming } from "../src/index.js";

function event(event, atMs, id = "main", request) {
  return {
    event,
    data: {
      invocation: { invocationId: id },
      transportRequestId: request,
      timing: { clockId: "test-process", atMs },
    },
  };
}
function replay() {
  return [
    event("model.invocation.started", 0),
    event("model.request.started", 10, "main", "r1"),
    event("model.invocation.started", 15, "aux"),
    event("model.request.started", 20, "aux", "r2"),
    event("model.request.finished", 40, "main", "r1"),
    event("model.request.finished", 50, "aux", "r2"),
    event("model.invocation.completed", 55, "aux"),
    event("model.request.started", 60, "main", "retry"),
    event("model.request.finished", 70, "main", "retry"),
    event("model.invocation.completed", 100),
  ];
}

test("pipeline timing excludes the union of parallel and retry transports in one clock domain", () => {
  assert.deepEqual(summarizeModelPipelineTiming(replay()), {
    clockId: "test-process",
    startMs: 0,
    endMs: 100,
    elapsedMs: 100,
    transportMs: 50,
    transportIntervals: [
      { clockId: "test-process", startMs: 10, endMs: 40 },
      { clockId: "test-process", startMs: 20, endMs: 50 },
      { clockId: "test-process", startMs: 60, endMs: 70 },
    ],
    localMs: 50,
    requestCount: 3,
    invocationCount: 2,
  });
  const cancelled = replay();
  cancelled.at(-1).event = "model.invocation.cancelled";
  assert.equal(summarizeModelPipelineTiming(cancelled).localMs, 50);
});

test("timing fails closed for missing, duplicate, reversed, incomplete or cross-process evidence", () => {
  for (const mutate of [
    (events) => delete events[0].data.timing,
    (events) => events.splice(1, 0, structuredClone(events[0])),
    (events) => (events[4].data.timing.atMs = 1),
    (events) => events.pop(),
    (events) => (events[3].data.timing.clockId = "other-process"),
    (events) => (events[4].data.transportRequestId = "unknown"),
    (events) => (events[4].data.timing.atMs = Infinity),
    (events) => (events[4].data.invocation.invocationId = "aux"),
    (events) => (events[1].data.invocation.invocationId = "unknown"),
    (events) => delete events[3].data.invocation,
    (events) => (events[5].data.timing.atMs = 56),
    (events) => {
      events[3].data.invocation.invocationId = "main";
      events[6].data.timing.atMs = 45;
    },
  ]) {
    const events = replay();
    mutate(events);
    assert.throws(() => summarizeModelPipelineTiming(events), TypeError);
  }
});
