/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from "vitest";
import { selectToolTimelineLogWindow } from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";

function callEntry(sequence, detail) {
  return {
    key: `call:${sequence}`,
    toolCallId: `call-${sequence}`,
    tool: "read_file",
    args: detail,
    call: {
      eventId: `event-${sequence}`,
      sequence,
      sequenceScopeId: "message-1",
      sequenceDomain: "message-event",
      authority: "authoritative",
    },
  };
}

describe("tool timeline realtime window", () => {
  it("projects only the newest canonical events without formatting archived details", () => {
    let serializedDetailCount = 0;
    const toolTimeline = Array.from({ length: 2000 }, (_, index) =>
      callEntry(index + 1, {
        index,
        toJSON() {
          serializedDetailCount += 1;
          return { index };
        },
      }),
    );

    const logs = selectToolTimelineLogWindow({ toolTimeline }, { limit: 10 });

    expect(logs).toHaveLength(10);
    expect(logs.map((item) => item.toolCallId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `call-${1991 + index}`),
    );
    expect(logs.every((item) => item.detailText === undefined)).toBe(true);
    expect(logs.every((item) => item.detailValue !== undefined)).toBe(true);
    expect(serializedDetailCount).toBe(0);
  });
});
