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
    expect(typeof record.detail.finishedReason).toBe("string");
    expect(record.detail.traces.length).toBeGreaterThan(0);
    for (const invocation of record.detail.traces) {
      expect(invocation.purpose).toBe(record.detail.purpose);
      expect(invocation.domain).toBe(record.domain);
      expect(Array.isArray(invocation.toolCalls)).toBe(true);
      expect(typeof invocation.finishedReason).toBe("string");
    }
  }
}
