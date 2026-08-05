/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

export function assertWorkflowExecutionTree(root, children = []) {
  expect(root.executionId).toBeTruthy();
  for (const child of children) {
    expect(child.executionId).toBeTruthy();
    expect(child.parentExecutionId).toBe(root.executionId);
    expect(child.executionId).not.toBe(root.executionId);
  }
}
