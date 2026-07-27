/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createWorkflowNodeViewTransaction } from "../components/workflow-message-card/workflowNodeViewTransaction.js";

describe("workflow node view transaction", () => {
  it("rejects an older generation even when the same step owner is reloaded", () => {
    const clearSnapshot = vi.fn();
    const replaceSnapshot = vi.fn();
    const mergeSnapshot = vi.fn();
    const transaction = createWorkflowNodeViewTransaction({
      clearSnapshot,
      replaceSnapshot,
      mergeSnapshot,
    });

    const first = transaction.begin("root:node-a");
    const second = transaction.begin("root:node-a");

    expect(transaction.replace(first, { messages: ["stale"] })).toBe(false);
    expect(transaction.activate(first)).toBe(false);
    expect(transaction.merge("root:node-a", { messages: ["too-early"] })).toBe(false);
    expect(transaction.replace(second, { messages: ["snapshot"] })).toBe(true);
    expect(transaction.activate(second)).toBe(true);
    expect(transaction.merge("root:node-a", { messages: ["live"] })).toBe(true);
    expect(clearSnapshot).toHaveBeenCalledTimes(2);
    expect(replaceSnapshot).toHaveBeenCalledExactlyOnceWith({ messages: ["snapshot"] });
    expect(mergeSnapshot).toHaveBeenCalledExactlyOnceWith({ messages: ["live"] });
  });

  it("invalidates the current ticket and clears its snapshot", () => {
    const clearSnapshot = vi.fn();
    const transaction = createWorkflowNodeViewTransaction({
      clearSnapshot,
      replaceSnapshot: vi.fn(),
      mergeSnapshot: vi.fn(),
    });
    const current = transaction.begin("root:node-a");

    transaction.invalidate();

    expect(transaction.accepts(current)).toBe(false);
    expect(transaction.state).toMatchObject({ ownerKey: "", phase: "idle" });
    expect(clearSnapshot).toHaveBeenCalledTimes(2);
  });
});
