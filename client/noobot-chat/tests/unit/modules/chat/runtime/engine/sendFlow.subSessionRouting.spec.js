/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import { routeMessageProjectionEvent } from "../../../../../../src/modules/chat/runtime/engine/messageProjectionRouter.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";

const childToolEvent = () =>
  canonicalMessageEvent({
    sessionId: "042e2095-166a-4ff0-b1c3-daf18779a75c",
    parentSessionId: "root-session-1",
    workflowRunId: "workflow-run-1",
    nodeExecutionId: "node-execution-1",
    presentationMessageId: "msg_55f39303-4216-4103-b500-c98983a9eb1e",
    toolCallId: "call_rp9JoyKOqvVwNpAJUobrY6bU",
    result: { ok: true },
    success: true,
    eventType: "tool_call_end",
    eventId: "event-2",
    turnScopeId: "workflow-node:client-turn_mrtd4rir_0g704tsc_a1_1",
    sequence: 2,
    occurredAt: "2026-07-21T00:00:00.000Z",
  });

describe("sendFlow sub-session message routing", () => {
  it("terminates a workflow node message event in the sub-session reducer", () => {
    const reduceSubSessionMessageEvent = vi.fn();
    const findMessagesByPresentationId = vi.fn();
    const envelope = childToolEvent();

    expect(
      routeMessageProjectionEvent(envelope, EVENT_FAMILY.MESSAGE_TIMELINE, {
        channelSessionId: "root-session-1",
        reduceSubSessionMessageEvent,
        findMessagesByPresentationId,
      }),
    ).toBe(true);

    expect(reduceSubSessionMessageEvent).toHaveBeenCalledWith(envelope);
    expect(findMessagesByPresentationId).not.toHaveBeenCalled();
  });

  it("leaves non message timeline families to later routes", () => {
    const reduceSubSessionMessageEvent = vi.fn();

    expect(routeMessageProjectionEvent(null, "", { reduceSubSessionMessageEvent })).toBe(false);
    expect(reduceSubSessionMessageEvent).not.toHaveBeenCalled();
  });
});
