/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { applyFoldedMessagesToActiveSession } from "../../../../../../src/modules/chat/runtime/reconnect/messageReplay.js";

describe("messageReplay", () => {
  it("can still replace the whole active session when no dialog process overlay is requested", () => {
    const activeSession = {
      value: {
        messages: [{ role: "assistant", pending: true, content: "old" }],
      },
    };

    applyFoldedMessagesToActiveSession(activeSession, [
      { role: "user", content: "question" },
      { role: "assistant", pending: false, content: "answer" },
    ]);

    expect(activeSession.value.messages.map((messageItem) => messageItem.content)).toEqual([
      "question",
      "answer",
    ]);
  });
});
