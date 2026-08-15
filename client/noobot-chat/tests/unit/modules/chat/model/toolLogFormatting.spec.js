/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from "vitest";

import {
  buildToolNameByCallId,
  buildToolResultSummary,
  isToolResultFailure,
  projectToolFileDisplay,
} from "../../../../../src/modules/chat/model/toolLogFormatting.js";

describe("tool log formatting", () => {
  it("uses the tool_call_id association for fallback result summaries", () => {
    const messages = [
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call-1",
            function: { name: "read_file", arguments: "{}" },
          },
        ],
      },
    ];
    const names = buildToolNameByCallId(messages);

    expect(buildToolResultSummary("plain file content", names.get("call-1"))).toBe("read_file");
    expect(buildToolResultSummary(JSON.stringify({ ok: true }), names.get("call-1"))).toBe(
      "read_file ok=true",
    );
  });
});

describe("tool file display projection", () => {
  it("projects logical paths and attachment identities without implicit object strings", () => {
    expect(projectToolFileDisplay({ view: "workspace", path: "src/report.csv" })).toBe(
      "src/report.csv",
    );
    expect(
      projectToolFileDisplay({
        view: "attachment",
        identity: {
          attachmentId: "att-report",
          sessionId: "session-1",
          attachmentSource: "user",
        },
      }),
    ).toBe("attachment:att-report");
    expect(
      projectToolFileDisplay({
        resourceId: "res_01J",
        logical: { view: "workspace", path: "reports/result.json" },
      }),
    ).toBe("reports/result.json");
  });
});

describe("tool result failure semantics", () => {
  it("uses canonical fields and tool output instead of display text", () => {
    expect(isToolResultFailure({ success: false })).toBe(true);
    expect(isToolResultFailure({ status: "failed" })).toBe(true);
    expect(isToolResultFailure({ result: { ok: false } })).toBe(true);
    expect(isToolResultFailure({ detailText: '{"status":"error"}' })).toBe(true);
    expect(isToolResultFailure({ result: { ok: true }, status: "completed" })).toBe(false);
  });
});
