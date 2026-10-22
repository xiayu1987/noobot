/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  applyReconnectMessagesToActiveSessionReplay,
  consumeReconnectReplayCacheForSession,
} from "../../../../../../src/modules/chat/runtime/reconnect/replayCacheConsumer.js";
import { StreamEventEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";
import { selectToolTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";
import { selectActivityTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/activityTimeline.js";
import { createTurnKey } from "../../../../../../src/modules/chat/runtime/engine/turnIdentity.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";

function authoritative(eventType, sequence, extra = {}) {
  const presentationMessageId = extra.presentationMessageId || "message-1";
  return canonicalMessageEvent({
    eventId: extra.eventId || `${presentationMessageId}-event-${sequence}`,
    eventType,
    sessionId: "s-1",
    presentationMessageId,
    dialogProcessId: extra.dialogProcessId || "dp-1",
    turnScopeId: extra.turnScopeId || "turn-1",
    sequence,
    occurredAt: `2026-07-22T05:00:${String(sequence).padStart(2, "0")}.000Z`,
    ...extra,
  });
}

function createActiveReplayFixture(overrides = {}) {
  const activeSession = {
    value: {
      id: "s-1",
      sessionId: "s-1",
      messages: [
        {
          presentationMessageId: "message-1",
          sessionId: "s-1",
          role: "assistant",
          dialogProcessId: "dp-1",
          turnScopeId: "turn-1",
          content: "",
        },
      ],
    },
  };

  const fixture = {
    activeSession,
    ...overrides,
  };
  fixture.findMessagesByPresentationId =
    overrides.findMessagesByPresentationId ||
    ((sessionId, presentationMessageId) =>
      sessionId === fixture.activeSession.value.sessionId
        ? fixture.activeSession.value.messages.filter(
            (message) => message.presentationMessageId === presentationMessageId,
          )
        : []);
  return fixture;
}

describe("replayCacheConsumer", () => {
  it("keeps cached workflow-node replay out of the root message consumer", async () => {
    const childMessages = [
      canonicalMessageEvent({
        eventId: "workflow-child-1",
        eventType: "thinking",
        sessionId: "child-session-1",
        turnScopeId: "workflow-node:node-1",
        presentationMessageId: "child-message-1",
        workflowRunId: "workflow-run-1",
        nodeExecutionId: "node-1",
        parentSessionId: "s-1",
        text: "working",
      }),
    ];
    const replayCache = {
      "s-1": { "__turn__s-1::workflow-node:node-1": childMessages },
    };
    const applyReconnectMessagesToActiveSession = vi.fn();
    const applySubSessionReplayMessages = vi.fn(async () => ({ applied: true }));

    await consumeReconnectReplayCacheForSession({
      replayCache,
      sessionId: "s-1",
      applyReconnectMessagesToActiveSession,
      applySubSessionReplayMessages,
    });

    expect(applySubSessionReplayMessages).toHaveBeenCalledWith(
      childMessages,
      expect.objectContaining({ rootSessionId: "s-1", turnScopeId: "workflow-node:node-1" }),
    );
    expect(applyReconnectMessagesToActiveSession).not.toHaveBeenCalled();
    expect(replayCache).toEqual({});
  });

  it("consumes cached replay groups for a session and removes the session cache", async () => {
    const turnOne = authoritative("llm_delta", 1, {
      eventId: "turn-1-event-1",
      presentationMessageId: "turn-1-message",
      text: "a",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
    });
    const turnTwo = authoritative("llm_delta", 1, {
      eventId: "turn-2-event-1",
      presentationMessageId: "turn-2-message",
      text: "b",
      dialogProcessId: "dp-2",
      turnScopeId: "turn-2",
    });
    const otherSession = authoritative("llm_delta", 1, {
      eventId: "turn-3-event-1",
      sessionId: "s-2",
      presentationMessageId: "turn-3-message",
      text: "c",
      dialogProcessId: "dp-3",
      turnScopeId: "turn-3",
    });
    const replayCache = {
      "s-1": {
        [createTurnKey({ sessionId: "s-1", turnScopeId: "turn-1" })]: [turnOne],
        [createTurnKey({ sessionId: "s-1", turnScopeId: "turn-2" })]: [turnTwo],
      },
      "s-2": {
        [createTurnKey({ sessionId: "s-2", turnScopeId: "turn-3" })]: [otherSession],
      },
    };
    const applyReconnectMessagesToActiveSession = vi.fn(async () => {});

    await consumeReconnectReplayCacheForSession({
      replayCache,
      sessionId: " s-1 ",
      applyReconnectMessagesToActiveSession,
    });

    expect(applyReconnectMessagesToActiveSession).toHaveBeenCalledTimes(2);
    expect(applyReconnectMessagesToActiveSession).toHaveBeenNthCalledWith(1, [turnOne], "dp-1", {
      turnScopeId: "turn-1",
    });
    expect(applyReconnectMessagesToActiveSession).toHaveBeenNthCalledWith(2, [turnTwo], "dp-2", {
      turnScopeId: "turn-2",
    });
    expect(replayCache).toEqual({
      "s-2": {
        [createTurnKey({ sessionId: "s-2", turnScopeId: "turn-3" })]: [otherSession],
      },
    });
  });

  it("keeps message replay independent from transport terminal frames", async () => {
    const fixture = createActiveReplayFixture();

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      messages: [authoritative("llm_delta", 1, { text: "final" })],
    });
    expect(fixture.activeSession.value.messages[0].content).toBe("final");
  });

  it("projects authoritative reconnect thinking without mutating process display mirrors", async () => {
    const hydratedCompletedLogs = Array.from({ length: 12 }, (_, index) => ({
      event: "tool_call",
      text: `old step ${index + 1}`,
      sequence: index + 1,
    }));
    const fixture = createActiveReplayFixture({
      activeSession: {
        value: {
          id: "s-1",
          sessionId: "s-1",
          messages: [
            {
              role: "assistant",
              presentationMessageId: "message-1",
              sessionId: "s-1",
              dialogProcessId: "dp-1",
              turnScopeId: "turn-1",
              content: "",
              pending: true,
              executionLogTotal: 12,
              realtimeLogs: hydratedCompletedLogs.slice(-10),
            },
          ],
        },
      },
    });

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      messages: [authoritative("thinking", 1, { text: "next step" })],
    });

    const targetMessage = fixture.activeSession.value.messages[0];
    expect(selectActivityTimelineLogs(targetMessage)).toHaveLength(1);
    expect(selectActivityTimelineLogs(targetMessage)[0].text).toContain("next step");
  });

  it("keeps legacy reconnect errors out of canonical messages and process display mirrors", async () => {
    const fixture = createActiveReplayFixture();

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      messages: [
        {
          event: StreamEventEnum.ERROR,
          data: {
            seq: 9,
            error: "tool failed",
            dialogProcessId: "dp-1",
            executionLogs: [
              { event: "tool_call", text: "run tool", dialogProcessId: "dp-1" },
              {
                event: "tool_result",
                text: "tool failed",
                status: "error",
                dialogProcessId: "dp-1",
              },
            ],
          },
        },
      ],
    });

    const targetMessage = fixture.activeSession.value.messages[0];
    expect(targetMessage.error).toBeUndefined();
    expect(targetMessage.processExecutionLogTotal).toBeUndefined();
    expect(targetMessage.processRealtimeLogs).toBeUndefined();
    expect(targetMessage.processCompletedToolLogs).toBeUndefined();
  });

  it("does not let legacy reconnect thinking mutate canonical timelines", async () => {
    const fixture = createActiveReplayFixture();

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      messages: [
        {
          event: "message",
          data: { seq: 7, text: "searching", event: "tool_call", dialogProcessId: "dp-1" },
        },
      ],
    });

    const targetMessage = fixture.activeSession.value.messages[0];
    expect(selectToolTimelineLogs(targetMessage)).toEqual([]);
    expect(selectActivityTimelineLogs(targetMessage)).toEqual([]);
    expect(targetMessage.processExecutionLogTotal).toBeUndefined();
    expect(targetMessage.processRealtimeLogs).toBeUndefined();
    expect(targetMessage.processCompletedToolLogs).toBeUndefined();
  });

  it("derives the continuation turn from cached envelopes before resolving a reused dialog", async () => {
    const stoppedAssistant = {
      role: "assistant",
      presentationMessageId: "message-stopped",
      sessionId: "s-1",
      dialogProcessId: "dp-shared",
      turnScopeId: "turn-stopped",
      content: "stopped",
      pending: false,
      realtimeLogs: [],
    };
    const continuationAssistant = {
      role: "assistant",
      presentationMessageId: "message-continuation",
      sessionId: "s-1",
      dialogProcessId: "dp-shared",
      turnScopeId: "turn-continuation",
      content: "",
      pending: true,
      realtimeLogs: [],
    };
    const fixture = createActiveReplayFixture({
      activeSession: {
        value: {
          id: "s-1",
          sessionId: "s-1",
          messages: [stoppedAssistant, continuationAssistant],
        },
      },
    });

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-shared",
      turnScopeId: "turn-continuation",
      messages: [
        authoritative("thinking", 1, {
          presentationMessageId: "message-continuation",
          text: "continuation tool",
          dialogProcessId: "dp-shared",
          turnScopeId: "turn-continuation",
        }),
      ],
    });

    expect(stoppedAssistant.realtimeLogs).toEqual([]);
    expect(selectToolTimelineLogs(stoppedAssistant)).toEqual([]);
    expect(selectActivityTimelineLogs(stoppedAssistant)).toEqual([]);
    expect(continuationAssistant.turnScopeId).toBe("turn-continuation");
    expect(selectActivityTimelineLogs(continuationAssistant)).toHaveLength(1);
    expect(selectActivityTimelineLogs(continuationAssistant)[0].text).toContain(
      "continuation tool",
    );
  });
});
