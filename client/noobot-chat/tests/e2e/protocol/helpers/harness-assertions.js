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

export function assertPairedCapabilityTraces(traces = []) {
  const starts = traces.filter((trace) => trace.phase === "start");
  const ends = traces.filter((trace) => trace.phase === "end");
  expect(ends.map((trace) => trace.traceId).sort()).toEqual(starts.map((trace) => trace.traceId).sort());
}
