/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

export function assertSessionIdentity(session, expected) {
  expect(session.sessionId || session.id).toBe(expected.sessionId);
  if (expected.userId) expect(session.userId).toBe(expected.userId);
}

export function assertMonotonicSessionVersions(records = []) {
  for (let index = 1; index < records.length; index += 1) {
    expect(records[index].version).toBeGreaterThan(records[index - 1].version);
  }
}
