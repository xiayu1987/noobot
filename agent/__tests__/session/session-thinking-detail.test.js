/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildThinkingDetailPayload } from "../../src/session/session-thinking-detail.js";

test("thinking detail message carries its session envelope identity and scoped injections", () => {
  const payload = buildThinkingDetailPayload({
    sessionId: "session-detail",
    sessions: [{
      sessionId: "session-detail",
      rawMessages: [
        {
          role: "assistant",
          type: "message",
          turnScopeId: "turn-detail",
          toolTimeline: [{ key: "call:one" }],
        },
        {
          role: "assistant",
          type: "message",
          turnScopeId: "turn-detail",
          injectedMessage: true,
          content: "guidance",
        },
      ],
    }],
  }, { turnScopeId: "turn-detail" });

  assert.equal(payload.messageItem.sessionId, "session-detail");
  assert.equal(payload.allMessages.filter((item) => item.injectedMessage === true).length, 1);
  assert.equal(payload.counts.injectedMessageCount, 1);
});
