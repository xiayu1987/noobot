/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { normalizeThinkingToolLogs } from "../../../../../src/modules/chat/model/thinkingDetailModel.js";

const fact = (eventId, sequence, event, text) => ({
  eventId, sequence, sequenceScopeId: "message-1", sequenceDomain: "message-event",
  authority: "authoritative", timestamp: `2026-07-25T01:00:0${sequence}.000Z`,
  log: { event, type: event, toolCallId: "call-1", text },
});

describe("thinking detail model canonical timeline", () => {
  it("projects call and result logs exclusively from toolTimeline", () => {
    const logs = normalizeThinkingToolLogs({ messageItem: { toolTimeline: [{
      key: "call:call-1", toolCallId: "call-1", status: "completed",
      call: fact("call-1", 1, "tool_call", "read_file"),
      resultEvent: fact("result-1", 2, "tool_result", "read_file done"),
    }] } });
    expect(logs.map((item) => item.event)).toEqual(["tool_call", "tool_result"]);
  });

  it("projects canonical tool arguments and results as expandable detail", () => {
    const logs = normalizeThinkingToolLogs({ messageItem: { toolTimeline: [{
      key: "call:call-detail",
      toolCallId: "call-detail",
      status: "completed",
      args: { filePath: "notes.txt", content: "hello" },
      result: { ok: true, filePath: "notes.txt" },
      call: {
        ...fact("call-detail", 1, "tool_call", "write_file"),
        log: {
          event: "tool_call",
          type: "tool_call",
          toolCallId: "call-detail",
          text: "write_file",
        },
      },
      resultEvent: {
        ...fact("result-detail", 2, "tool_result", "write_file done"),
        log: {
          event: "tool_result",
          type: "tool_result",
          toolCallId: "call-detail",
          text: "write_file done",
        },
      },
    }] } });

    expect(logs[0].detailText).toContain('"filePath": "notes.txt"');
    expect(logs[0].detailText).toContain('"content": "hello"');
    expect(logs[1].detailText).toContain('"ok": true');
  });

  it("does not synthesize timeline facts from historical messages", () => {
    expect(normalizeThinkingToolLogs({
      messageItem: {},
      allMessages: [{ role: "tool", type: "tool_result", content: "legacy result" }],
      sessionDocs: [{ messages: [{ role: "assistant", tool_calls: [{ id: "call-1" }] }] }],
    })).toEqual([]);
  });

  it("does not read removed realtime or completed log fields", () => {
    expect(normalizeThinkingToolLogs({ messageItem: {
      realtimeLogs: [{ event: "tool_call", text: "legacy call" }],
      completedToolLogs: [{ event: "tool_result", text: "legacy result" }],
    } })).toEqual([]);
  });
});
