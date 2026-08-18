/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { shouldProjectSubSessionEvent } from "../../../../../../src/modules/chat/runtime/engine/sendFlow.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";

describe("sendFlow sub-session message routing", () => {
  it("projects an authoritative child tool event without workflow node metadata", () => {
    expect(shouldProjectSubSessionEvent("message_event", canonicalMessageEvent({
        sessionId: "042e2095-166a-4ff0-b1c3-daf18779a75c",
        parentSessionId: "root-session-1",
        workflowRunId: "workflow-run-1",
        nodeExecutionId: "node-execution-1",
        messageId: "msg_55f39303-4216-4103-b500-c98983a9eb1e",
        presentationMessageId: "msg_55f39303-4216-4103-b500-c98983a9eb1e",
        toolCallId: "call_rp9JoyKOqvVwNpAJUobrY6bU",
        result: { ok: true },
        success: true,
        eventType: "tool_call_end",
        eventId: "event-2",
        turnScopeId: "workflow-node:client-turn_mrtd4rir_0g704tsc_a1_1",
        sequence: 2,
        occurredAt: "2026-07-21T00:00:00.000Z",
      }))).toBe(true);
  });

  it("does not project an unaddressed child lifecycle event", () => {
    expect(shouldProjectSubSessionEvent("subagent_event", {
      scope: "sub_session",
      sessionId: "child-session",
    })).toBe(false);
  });
});
