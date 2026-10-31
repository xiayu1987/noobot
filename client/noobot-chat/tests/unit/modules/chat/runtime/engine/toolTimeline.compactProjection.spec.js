/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  selectCompletedToolArtifacts,
  selectToolTimelineLogs,
} from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";

const compactServerTimelineEntry = {
  key: "call:tc-1",
  toolCallId: "tc-1",
  tool: "read_file",
  status: "completed",
  success: true,
  call: { eventId: "e-1", sequence: 1, summary: "read_file · a.txt" },
  resultEvent: { eventId: "e-2", sequence: 2, summary: "read_file · a.txt" },
};

describe("toolTimeline compact projection", () => {
  it("uses server summaries for compact entries without args/result", () => {
    const message = { toolTimeline: [compactServerTimelineEntry] };
    expect(() => selectCompletedToolArtifacts(message)).not.toThrow();
    const logs = selectToolTimelineLogs(message);
    expect(logs.map((log) => log.text)).toEqual(["read_file · a.txt", "read_file · a.txt"]);
  });

  it("keeps strict result validation for full entries", () => {
    const message = {
      toolTimeline: [{ ...compactServerTimelineEntry, args: { filePath: "a.txt" }, result: 1 }],
    };
    expect(() => selectToolTimelineLogs(message)).toThrow("tool_result_not_object");
  });
});
