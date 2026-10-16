/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { projectExecutionLogDisplay } from "../../../../../../src/modules/chat/runtime/engine/utils.js";
import { selectToolTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";

function timelineLogs({ success = true } = {}) {
  return selectToolTimelineLogs({
    toolTimeline: [
      {
        key: "call:call-1",
        toolCallId: "call-1",
        tool: "read_file",
        args: { filePath: "/project/package.json" },
        result: "{}",
        success,
        call: { eventId: "evt-call", sequence: 1 },
        resultEvent: { eventId: "evt-result", sequence: 2 },
      },
    ],
  }).map(projectExecutionLogDisplay);
}

describe("projectExecutionLogDisplay", () => {
  it("keeps the operation summary for tool calls", () => {
    const [call] = timelineLogs();

    expect(call).toEqual(expect.objectContaining({ event: "tool_call" }));
    expect(call.text).toMatch(/^read_file · /);
    expect(call.statusKey).toBeUndefined();
  });

  it("shows tool name with completed status for successful results", () => {
    const [, result] = timelineLogs();

    expect(result).toEqual(
      expect.objectContaining({
        event: "tool_result",
        text: "read_file",
        statusKey: "message.executionStatusCompleted",
      }),
    );
  });

  it("shows failed status for unsuccessful results", () => {
    const [, result] = timelineLogs({ success: false });

    expect(result.statusKey).toBe("message.executionStatusFailed");
  });
});
