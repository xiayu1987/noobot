/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/thinking-detail/tool-calls-and-results.json";
import { normalizeThinkingToolLogs } from "../../../src/composables/infra/thinkingDetailModel";

describe("thinking detail model", () => {
  it("normalizes a real response shape with empty call text", () => {
    const logs = normalizeThinkingToolLogs({
      ...fixture,
      variant: "details",
      toolResultFallback: "tool_result",
    });

    expect(logs.map((item) => item.event)).toEqual([
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
    ]);
    expect(logs.map((item) => item.toolCallId || item.tool_call_id)).toEqual([
      "call-search",
      "call-search",
      "call-read",
      "call-read",
    ]);
    expect(logs[0].text).toContain("search");
    expect(logs[0].text).toContain("completedToolLogs");
    expect(logs[2].text).toContain("read_file");
    expect(logs[1].detailText).toContain('"ok":true');
  });

  it("keeps non-empty server projections authoritative", () => {
    const logs = normalizeThinkingToolLogs({
      messageItem: {
        ...fixture.messageItem,
        completedToolLogs: [{
          event: "tool_result",
          type: "tool_result",
          text: "server result",
          toolCallId: "call-search",
          ts: "2026-07-18T01:00:01.000Z",
        }],
      },
      allMessages: fixture.allMessages,
      variant: "details",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].text).toBe("server result");
  });

  it("deduplicates equivalent event and call id pairs", () => {
    const result = fixture.messageItem.completedToolLogs[1];
    const logs = normalizeThinkingToolLogs({
      messageItem: {
        ...fixture.messageItem,
        completedToolLogs: [result, { ...result, text: "duplicate" }],
      },
      allMessages: fixture.allMessages,
      variant: "details",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].text).toBe("search ok=true");
  });

  it("uses scoped allMessages as the authoritative history source", () => {
    const logs = normalizeThinkingToolLogs({
      messageItem: {
        role: "assistant",
        sessionId: "root",
        turnScopeId: "client-turn:history",
      },
      allMessages: [{
        role: "assistant",
        type: "tool_call",
        sessionId: "root",
        turnScopeId: "client-turn:history",
        ts: "2026-07-18T01:00:00.000Z",
        tool_calls: [{ id: "call-current", function: { name: "current_tool", arguments: "{}" } }],
      }],
      sessionDocs: [{
        sessionId: "root",
        messages: [{
          role: "assistant",
          type: "tool_call",
          sessionId: "root",
          turnScopeId: "client-turn:history",
          tool_calls: [{ id: "call-stale", function: { name: "stale_tool", arguments: "{}" } }],
        }],
      }],
      variant: "details",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].toolCallId).toBe("call-current");
    expect(logs[0].text).toContain("current_tool");
  });

  it("falls back to workflow sessionDocs when allMessages has no scoped raw messages", () => {
    const logs = normalizeThinkingToolLogs({
      messageItem: {
        role: "assistant",
        sessionId: "node-session-1",
        dialogProcessId: "workflow-dialog",
        turnScopeId: "client-turn:workflow",
      },
      allMessages: [],
      sessionDocs: [{
        sessionId: "node-session-1",
        messages: [
          {
            role: "assistant",
            type: "tool_call",
            sessionId: "node-session-1",
            dialogProcessId: "workflow-dialog",
            turnScopeId: "client-turn:workflow",
            ts: "2026-07-18T01:00:00.000Z",
            tool_calls: [{ id: "call-workflow", function: { name: "workflow_tool", arguments: "{\"node\":1}" } }],
          },
          {
            role: "tool",
            type: "tool_result",
            sessionId: "node-session-1",
            dialogProcessId: "workflow-dialog",
            turnScopeId: "client-turn:workflow",
            ts: "2026-07-18T01:00:01.000Z",
            tool_call_id: "call-workflow",
            content: "{\"ok\":true}",
          },
        ],
      }],
      variant: "details",
    });

    expect(logs.map((item) => item.event)).toEqual(["tool_call", "tool_result"]);
    expect(logs[0].text).toContain("workflow_tool");
    expect(logs[1].detailText).toContain('"ok":true');
  });
});
