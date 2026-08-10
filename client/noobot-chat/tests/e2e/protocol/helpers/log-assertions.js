/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

const FORBIDDEN = [
  /invalid agent context envelope/i,
  /must be a plain object/i,
  /authoritative_snapshot_failed/i,
  /snapshot_timeout/i,
  /duplicate canonical attachment/i,
  /invalid_attachment_id/i,
  /session identity conflict/i,
];

export function assertNoForbiddenErrors(records = []) {
  const violations = records.filter((record) => FORBIDDEN.some((pattern) => pattern.test(String(record.text || record.message || record))));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}
