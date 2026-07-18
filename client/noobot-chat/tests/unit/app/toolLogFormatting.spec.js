/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from "vitest";

import {
  buildToolNameByCallId,
  buildToolResultSummary,
} from "../../../src/composables/infra/toolLogFormatting";

describe("tool log formatting", () => {
  it("uses the tool_call_id association for fallback result summaries", () => {
    const messages = [{
      role: "assistant",
      tool_calls: [{
        id: "call-1",
        function: { name: "read_file", arguments: "{}" },
      }],
    }];
    const names = buildToolNameByCallId(messages);

    expect(buildToolResultSummary("plain file content", names.get("call-1")))
      .toBe("read_file");
    expect(buildToolResultSummary(
      JSON.stringify({ ok: true }),
      names.get("call-1"),
    )).toBe("read_file ok=true");
  });
});
