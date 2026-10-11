/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { buildStreamEventLogEntry } from "../../../../../../src/modules/chat/runtime/engine/streamEventLogEntry.js";
import { StreamEventEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";

const route = {
  botMsg: { dialogProcessId: "dp-bot" },
  sessionId: "route-session",
  turnScopeId: "route-turn",
};

describe("buildStreamEventLogEntry identity", () => {
  it("takes identity only from the protocol envelope when one is present", () => {
    const envelope = canonicalMessageEvent({ eventType: "thinking", text: "x", eventId: "e1" });
    const entry = buildStreamEventLogEntry({
      ...route,
      authoritativeEvent: envelope,
      data: { sessionId: "data-session", turnScopeId: "data-turn", dialogProcessId: "dp-data" },
      event: "message_event",
    });
    expect(entry).toMatchObject({
      sessionId: envelope.identity.sessionId,
      turnScopeId: envelope.identity.turnScopeId,
      dialogProcessId: String(envelope.payload.dialogProcessId || ""),
    });
  });

  it("uses the stream route identity without an envelope and keeps event identity in data", () => {
    const entry = buildStreamEventLogEntry({
      ...route,
      authoritativeEvent: null,
      data: {
        sessionId: "child-session",
        parentSessionId: "route-session",
        turnScopeId: "child-turn",
        dialogProcessId: "dp-child",
      },
      event: StreamEventEnum.TURN_LIFECYCLE,
    });
    expect(entry).toMatchObject({
      sessionId: "route-session",
      turnScopeId: "route-turn",
      dialogProcessId: "dp-bot",
    });
    expect(entry.data).toMatchObject({
      childSessionId: "child-session",
      eventSessionId: "child-session",
      eventTurnScopeId: "child-turn",
      eventDialogProcessId: "dp-child",
      parentSessionId: "route-session",
    });
  });
});
