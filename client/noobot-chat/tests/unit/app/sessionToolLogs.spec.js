/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { applyCompletedToolLogsToMessages } from "../../../src/composables/infra/sessionToolLogs";

describe("session tool logs", () => {
  it("attaches raw workflow node tool logs to a summary display message by turnScopeId", () => {
    const turnScopeId = "workflow-node:dialog-1";
    const displayMessages = [
      {
        role: "assistant",
        type: "message",
        sessionId: "node-session-1",
        turnScopeId,
        hasThinkingDetails: true,
        thinkingDetailCount: 2,
      },
    ];
    const sessionDocuments = [
      {
        sessionId: "node-session-1",
        parentSessionId: "root-session-1",
        caller: "bot",
        depth: 1,
        messages: [
          {
            role: "assistant",
            type: "message",
            sessionId: "node-session-1",
            turnScopeId,
            content: "done",
            ts: "2026-06-23T00:00:00.000Z",
          },
          {
            role: "assistant",
            type: "tool_call",
            sessionId: "node-session-1",
            turnScopeId,
            tool_calls: [
              { id: "call-1", function: { name: "search", arguments: "{\"q\":\"x\"}" } },
            ],
            ts: "2026-06-23T00:00:01.000Z",
          },
          {
            role: "tool",
            type: "tool_result",
            sessionId: "node-session-1",
            turnScopeId,
            tool_call_id: "call-1",
            content: "ok",
            ts: "2026-06-23T00:00:02.000Z",
          },
        ],
      },
    ];

    applyCompletedToolLogsToMessages(displayMessages, sessionDocuments);

    expect(displayMessages[0].completedToolLogs).toHaveLength(2);
    expect(displayMessages[0].completedToolLogs.map((item) => item.type)).toEqual([
      "tool_call",
      "tool_result",
    ]);
    expect(displayMessages[0].completedToolLogs[1].text).toBe("search");
    expect(displayMessages[0].completedToolLogs[1].detailText).toBe("ok");
  });

  it("keeps plain-text tool results out of the summary", () => {
    const displayMessages = [
      {
        role: "assistant",
        type: "message",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        hasThinkingDetails: true,
        thinkingDetailCount: 2,
      },
    ];
    const sessionDocuments = [
      {
        sessionId: "session-1",
        parentSessionId: "root-1",
        caller: "bot",
        depth: 1,
        messages: [
          {
            role: "assistant",
            type: "tool_call",
            sessionId: "session-1",
            turnScopeId: "turn-1",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "read_file", arguments: "{}" },
              },
            ],
          },
          {
            role: "tool",
            type: "tool_result",
            sessionId: "session-1",
            turnScopeId: "turn-1",
            tool_call_id: "call-1",
            content: "the complete file content",
          },
        ],
      },
    ];

    applyCompletedToolLogsToMessages(displayMessages, sessionDocuments);

    expect(displayMessages[0].completedToolLogs[1].text).toBe("read_file");
    expect(displayMessages[0].completedToolLogs[1].detailText).toBe(
      "the complete file content",
    );
  });

  it("renders realtime authoritative tool envelopes before the scoped snapshot is persisted", () => {
    const turnScopeId = "workflow-node:live";
    const displayMessages = [{
      role: "assistant",
      type: "message",
      sessionId: "node-live",
      turnScopeId,
    }];
    const sessionDocuments = [{
      sessionId: "node-live",
      parentSessionId: "root-1",
      caller: "bot",
      depth: 1,
      messages: [{
        id: "msg-live",
        role: "assistant",
        type: "message",
        sessionId: "node-live",
        turnScopeId,
        rawEvents: [
          {
            event: "tool_call_start",
            data: {
              eventType: "tool_call_start",
              tool: "read_file",
              args: { filePath: "notes.txt" },
              toolCallId: "call-live",
              timestamp: "2026-07-21T00:00:00.000Z",
            },
          },
          {
            event: "tool_call_end",
            data: {
              eventType: "tool_call_end",
              tool: "read_file",
              result: "file body",
              success: true,
              toolCallId: "call-live",
              timestamp: "2026-07-21T00:00:01.000Z",
            },
          },
        ],
      }],
    }];

    applyCompletedToolLogsToMessages(displayMessages, sessionDocuments);

    expect(displayMessages[0].completedToolLogs.map((item) => item.type)).toEqual([
      "tool_call",
      "tool_result",
    ]);
    expect(displayMessages[0].completedToolLogs[0].text).toBe('read_file({"filePath":"notes.txt"})');
    expect(displayMessages[0].completedToolLogs[1].text).toBe("read_file ok=true");
    expect(displayMessages[0].completedToolLogs[1].detailText).toBe("file body");
  });
});
