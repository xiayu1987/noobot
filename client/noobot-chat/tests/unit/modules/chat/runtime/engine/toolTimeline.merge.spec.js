/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { mergeToolTimelines } from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";

describe("mergeToolTimelines identity", () => {
  it("merges entries by toolCallId when key is absent", () => {
    const merged = mergeToolTimelines(
      [{ toolCallId: "call-1", call: { sequence: 1 } }],
      [{ toolCallId: "call-1", success: true, resultEvent: { sequence: 2 } }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe("call:call-1");
    expect(merged[0].call).toBeTruthy();
    expect(merged[0].resultEvent).toBeTruthy();
  });

  it("does not derive identity from tool_call_id or id aliases", () => {
    const merged = mergeToolTimelines([
      { tool_call_id: "call-2", call: { sequence: 1 } },
      { id: "call-3", call: { sequence: 2 } },
    ]);
    expect(merged).toEqual([]);
  });

  it("falls back to eventId only", () => {
    const merged = mergeToolTimelines([{ eventId: "evt-1", call: { sequence: 1 } }]);
    expect(merged.map((entry) => entry.key)).toEqual(["event:evt-1"]);
  });
});
