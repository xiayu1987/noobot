/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertModelMessageSnapshot(snapshot) {
  expect(snapshot.version).toBe(2);
  expect(snapshot.sessionId).toBeTruthy();
  expect(snapshot.dialogProcessId).toBeTruthy();
  expect(snapshot.turnScopeId).toBeTruthy();
  for (const name of ["system", "history", "incremental"]) {
    expect(Array.isArray(snapshot.messageBlocks?.[name])).toBe(true);
    for (const block of snapshot.messageBlocks[name]) expect(isPlainObject(block)).toBe(true);
  }
  expect(Date.parse(snapshot.updatedAt)).toBeGreaterThanOrEqual(Date.parse(snapshot.createdAt));
}
