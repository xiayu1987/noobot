/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createTurnLifecycleEnvelope } from "@noobot/session-protocol";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";

function lifecycle(eventType, sequence, state, executionState, extra = {}) {
  return createTurnLifecycleEnvelope({
    eventType,
    eventId: `event-${sequence}`,
    commandId: "command-turn-a",
    userId: "admin",
    sessionId: "session-a",
    dialogProcessId: "dialog-a",
    turnScopeId: "client-turn:a",
    messageId: "assistant-a",
    presentationMessageId: "assistant-a",
    revision: sequence,
    sequence,
    occurredAt: `2026-08-07T00:00:0${sequence}.000Z`,
    phase: eventType === "turn.completed" ? "completion" : "action",
    state,
    action: "send",
    executionState,
    capabilities: { actionLocked: eventType !== "turn.completed", canStop: false },
    ...extra,
  });
}

describe("useChatStore interaction lifecycle", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("closes the same Turn interaction when Authority commits a terminal lifecycle", () => {
    const store = useChatStore();
    store.activeSessionId = "session-a";
    store.pendingInteractionRequests = [{
      requestId: "interaction-a",
      sessionId: "session-a",
      dialogProcessId: "dialog-a",
      turnScopeId: "client-turn:a",
    }, {
      requestId: "interaction-b",
      sessionId: "session-b",
      dialogProcessId: "dialog-b",
      turnScopeId: "client-turn:b",
    }];
    store.pendingInteractionRequest = store.pendingInteractionRequests[0];

    expect(store.applyTurnLifecycleEnvelope(
      lifecycle("turn.action_accepted", 1, "action_requesting", "accepted"),
    ).applied).toBe(true);
    expect(store.pendingInteractionRequest?.requestId).toBe("interaction-a");

    expect(store.applyTurnLifecycleEnvelope(lifecycle(
      "turn.completed",
      2,
      "completed",
      "completed",
      { completionCommitId: "commit-a", summaryVersion: 1 },
    )).applied).toBe(true);
    expect(store.pendingInteractionRequests.map((item) => item.requestId)).toEqual(["interaction-b"]);
    expect(store.pendingInteractionRequest).toBeNull();
  });
});
