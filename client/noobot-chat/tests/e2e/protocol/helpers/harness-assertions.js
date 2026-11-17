/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { isPlainObject } from "@noobot/shared/value";

export function assertHarnessRun(run, { dialogProcessId, status }) {
  assert.equal(run.plugin, "noobot-plugin-harness");
  assert.equal(run.dialogProcessId, dialogProcessId);
  assert.equal(run.status, status);
}

export function assertCapabilityModelTraces(traces = []) {
  assert.ok(traces.length > 0);
  const traceIds = new Set();
  for (const record of traces) {
    assert.equal(record.event, "capability_model_trace");
    assert.equal(typeof record.eventId, "string");
    assert.ok(record.eventId.length > 0);
    assert.equal(typeof record.traceId, "string");
    assert.ok(record.traceId.length > 0);
    assert.equal(traceIds.has(record.traceId), false);
    traceIds.add(record.traceId);
    assert.equal(typeof record.domain, "string");
    assert.ok(record.domain.length > 0);
    assert.ok(isPlainObject(record.detail));
    assert.equal(typeof record.detail.purpose, "string");
    assert.ok(record.detail.purpose.length > 0);
    assert.ok(Array.isArray(record.detail.modelAttempts));
    assert.ok(record.detail.modelAttempts.length > 0);
    for (const attempt of record.detail.modelAttempts) {
      assert.ok(Number.isInteger(attempt.attempt));
      assert.ok(attempt.attempt > 0);
      assert.ok(["completed", "retry", "failed"].includes(attempt.status));
      assert.equal(typeof attempt.kind, "string");
      assert.ok(attempt.kind.length > 0);
      assert.equal(typeof attempt.streaming, "boolean");
      if (attempt.output) {
        assert.ok(Array.isArray(attempt.output.toolCalls));
        assert.equal(typeof attempt.output.finishReason, "string");
      }
      if (attempt.status === "completed") assert.ok(attempt.output);
      if (attempt.status === "failed") {
        assert.ok(attempt.output || attempt.error);
      }
    }
  }
}
