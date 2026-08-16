/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

export function assertHarnessRun(run, { dialogProcessId, status }) {
  expect(run.plugin).toBe("noobot-plugin-harness");
  expect(run.dialogProcessId).toBe(dialogProcessId);
  expect(run.status).toBe(status);
}

export function assertCapabilityModelTraces(traces = []) {
  expect(traces.length).toBeGreaterThan(0);
  const traceIds = new Set();
  for (const record of traces) {
    expect(record.event).toBe("capability_model_trace");
    expect(typeof record.eventId).toBe("string");
    expect(record.eventId.length).toBeGreaterThan(0);
    expect(typeof record.traceId).toBe("string");
    expect(record.traceId.length).toBeGreaterThan(0);
    expect(traceIds.has(record.traceId)).toBe(false);
    traceIds.add(record.traceId);
    expect(typeof record.domain).toBe("string");
    expect(record.domain.length).toBeGreaterThan(0);
    expect(record.detail && typeof record.detail === "object" && !Array.isArray(record.detail)).toBe(true);
    expect(typeof record.detail.purpose).toBe("string");
    expect(record.detail.purpose.length).toBeGreaterThan(0);
    expect(Array.isArray(record.detail.modelAttempts)).toBe(true);
    expect(record.detail.modelAttempts.length).toBeGreaterThan(0);
    for (const attempt of record.detail.modelAttempts) {
      expect(Number.isInteger(attempt.attempt)).toBe(true);
      expect(attempt.attempt).toBeGreaterThan(0);
      expect(["completed", "retry", "failed"]).toContain(attempt.status);
      expect(typeof attempt.kind).toBe("string");
      expect(attempt.kind.length).toBeGreaterThan(0);
      expect(typeof attempt.streaming).toBe("boolean");
      if (attempt.output) {
        expect(Array.isArray(attempt.output.toolCalls)).toBe(true);
        expect(typeof attempt.output.finishReason).toBe("string");
      }
      if (attempt.status === "completed") expect(attempt.output).toBeTruthy();
      if (attempt.status === "failed") {
        expect(Boolean(attempt.output || attempt.error)).toBe(true);
      }
    }
  }
}
