/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { deduplicateToolLogs } from "../../../src/composables/infra/toolLogIdentity";

const result = (overrides = {}) => ({ event: "tool_result", type: "tool_result", ...overrides });

 describe("tool log identity", () => {
  it("keeps the readable projection for the same call id", () => {
    const logs = deduplicateToolLogs([
      result({ toolCallId: "call-1", detailText: "ok", text: "" }),
      result({ toolCallId: "call-1", detailText: "ok", text: "search ok" }),
    ]);
    expect(logs).toHaveLength(1);
    expect(logs[0].text).toBe("search ok");
  });

  it("bridges an id-less compact result to an identified full result", () => {
    const logs = deduplicateToolLogs([
      result({ detailText: "same", text: "" }),
      result({ toolCallId: "call-1", detailText: "same", text: "full" }),
    ]);
    expect(logs).toHaveLength(1);
    expect(logs[0].toolCallId).toBe("call-1");
  });

  it("keeps id-less results with different content", () => {
    const logs = deduplicateToolLogs([
      result({ detailText: "one" }),
      result({ detailText: "two" }),
    ]);
    expect(logs).toHaveLength(2);
  });

  it("does not merge different call ids with identical content", () => {
    const logs = deduplicateToolLogs([
      result({ toolCallId: "call-1", detailText: "same" }),
      result({ toolCallId: "call-2", detailText: "same" }),
    ]);
    expect(logs).toHaveLength(2);
  });

  it("does not merge tool calls and results", () => {
    const logs = deduplicateToolLogs([
      { event: "tool_call", toolCallId: "call-1", text: "search" },
      result({ toolCallId: "call-1", detailText: "search" }),
    ]);
    expect(logs).toHaveLength(2);
  });

  it("keeps id-less tool calls as separate rows", () => {
    const logs = deduplicateToolLogs([
      { event: "tool_call", text: "first" },
      { event: "tool_call", text: "second" },
    ]);
    expect(logs).toHaveLength(2);
  });
});
