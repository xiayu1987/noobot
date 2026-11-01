/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { mergeToolTimelines } from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";

describe("mergeToolTimelines identity", () => {
  it("merges entries by the canonical tool call key", () => {
    const merged = mergeToolTimelines(
      [{ key: "call:call-1", toolCallId: "call-1", call: { sequence: 1 } }],
      [{ key: "call:call-1", toolCallId: "call-1", success: true, resultEvent: { sequence: 2 } }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe("call:call-1");
    expect(merged[0].call).toBeTruthy();
    expect(merged[0].resultEvent).toBeTruthy();
  });

  it.each([
    { tool_call_id: "call-2" },
    { id: "call-3" },
    { eventId: "evt-1" },
    { toolCallId: "call-1" },
    { key: "call:wrong", toolCallId: "call-1" },
    {},
  ])("rejects noncanonical timeline identities: %j", (entry) => {
    expect(() => mergeToolTimelines([entry])).toThrow(/requires key call:<toolCallId>/);
  });
});
