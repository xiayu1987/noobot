/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  normalizeExecutionLogForRealtime,
  sanitizeExecutionLogForDisplay,
  stripInternalEventPlaceholderLines,
} from "../../../../../../src/modules/chat/runtime/engine/utils.js";

describe("chatEngine utils", () => {
  it("strips internal event placeholder lines from assistant content", () => {
    const content = stripInternalEventPlaceholderLines(
      [
        "[tool_call]",
        "[session_turn_full]",
        "[system]",
        "[assistant_message_saved]",
        "[tool_result]",
      ].join("\n"),
    );

    expect(content).toBe("");
  });

  it("sanitizes internal placeholders from execution logs", () => {
    const samples = [
      "[tool_call]",
      "[session_turn_full]",
      "[system]",
      "[assistant_message_saved]",
      "[tool_result]",
    ];

    for (const sample of samples) {
      const logItem = normalizeExecutionLogForRealtime({ text: sample, event: "tool_call" });

      expect(logItem.text).toBe("");
      expect(sanitizeExecutionLogForDisplay(logItem)).toBeNull();
    }
  });

  it("keeps readable execution log text and normal tool events", () => {
    const logItem = normalizeExecutionLogForRealtime({
      event: "tool_call",
      type: "tool_call",
      category: "tool",
      text: "npm test",
    });

    expect(sanitizeExecutionLogForDisplay(logItem)).toEqual(
      expect.objectContaining({
        event: "tool_call",
        type: "tool_call",
        text: "npm test",
      }),
    );
  });

  it("shows concrete command during tool_call from command fields", () => {
    const logItem = normalizeExecutionLogForRealtime({
      event: "tool_call",
      type: "tool_call",
      category: "tool",
      text: "read_file started",
      command: "read_file /project/client/noobot-chat/package.json",
    });

    expect(sanitizeExecutionLogForDisplay(logItem)).toEqual(
      expect.objectContaining({
        text: "read_file /project/client/noobot-chat/package.json",
      }),
    );
  });

  it("builds concrete command from tool name and raw args when text is only status", () => {
    const logItem = normalizeExecutionLogForRealtime({
      event: "tool_call",
      type: "tool_call",
      category: "tool",
      text: "read_file started",
      name: "read_file",
      rawInput: { filePath: "/project/client/noobot-chat/package.json" },
    });

    expect(sanitizeExecutionLogForDisplay(logItem)?.text).toBe(
      'read_file {"filePath":"/project/client/noobot-chat/package.json"}',
    );
  });

  it("keeps authoritative tool result status as a structured status key", () => {
    expect(
      sanitizeExecutionLogForDisplay({
        event: "tool_result",
        type: "tool_result",
        eventType: "tool_call_end",
        tool: "read_file",
        text: "read_file completed",
        success: true,
      }),
    ).toEqual(
      expect.objectContaining({ text: "read_file", statusKey: "message.executionStatusCompleted" }),
    );

    expect(
      sanitizeExecutionLogForDisplay({
        event: "tool_result",
        type: "tool_result",
        rawEvent: "tool_call_end",
        tool: "execute_script",
        text: "execute_script completed",
        success: false,
      }),
    ).toEqual(
      expect.objectContaining({
        text: "execute_script",
        statusKey: "message.executionStatusFailed",
      }),
    );
  });

  it("falls back to status text without blank or undefined when command fields are missing", () => {
    expect(
      sanitizeExecutionLogForDisplay({
        event: "tool_call",
        type: "tool_call",
        text: "read_file started",
      })?.text,
    ).toBe("read_file started");
  });

  it("hides internal container events even when they include text", () => {
    expect(
      sanitizeExecutionLogForDisplay({
        event: "session_turn_full",
        type: "system",
        text: "[session_turn_full]",
      }),
    ).toBeNull();
  });
});
