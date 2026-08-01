/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { deduplicateToolLogs } from "../../../../../src/modules/chat/model/toolLogIdentity.js";

const result = (overrides = {}) => ({ event: "tool_result", type: "tool_result", ...overrides });

 describe("tool log identity", () => {
  it("keeps the readable projection for the same call id", () => {
    const logs = deduplicateToolLogs([
      result({ eventId: "result-1", toolCallId: "call-1", detailText: "ok", text: "" }),
      result({ eventId: "result-1", toolCallId: "call-1", detailText: "ok", text: "search ok" }),
    ]);
    expect(logs).toHaveLength(1);
    expect(logs[0].text).toBe("search ok");
  });

  it("does not infer identity between an id-less result and a canonical event", () => {
    const logs = deduplicateToolLogs([
      result({ detailText: "same", text: "" }),
      result({ eventId: "result-1", toolCallId: "call-1", detailText: "same", text: "full" }),
    ]);
    expect(logs).toHaveLength(2);
    expect(logs[1].toolCallId).toBe("call-1");
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
      result({ eventId: "result-1", toolCallId: "call-1", detailText: "same" }),
      result({ eventId: "result-2", toolCallId: "call-2", detailText: "same" }),
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
