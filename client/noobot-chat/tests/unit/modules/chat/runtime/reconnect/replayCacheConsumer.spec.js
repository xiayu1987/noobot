/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  applyReconnectMessagesToActiveSessionReplay,
  consumeReconnectReplayCacheForSession,
  markReconnectSequenceApplied,
} from "../../../../../../src/modules/chat/runtime/reconnect/replayCacheConsumer.js";
import { StreamEventEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";
import { selectToolTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";
import { selectActivityTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/activityTimeline.js";

function authoritative(eventType, sequence, extra = {}) {
  const messageId = extra.messageId || "message-1";
  return {
    event: "message_event",
    sequence,
    data: {
      event: {
        envelopeKind: "noobot.message_event",
        envelopeVersion: 2,
        eventId: extra.eventId || `${messageId}-event-${sequence}`,
        eventType,
        sessionId: "s-1",
        messageId,
        presentationMessageId: extra.presentationMessageId || messageId,
        sequenceDomain: "message-event",
        sequenceScopeId: messageId,
        dialogProcessId: extra.dialogProcessId || "dp-1",
        turnScopeId: extra.turnScopeId || "turn-1",
        sequence,
        timestamp: `2026-07-22T05:00:${String(sequence).padStart(2, "0")}.000Z`,
        ...extra,
      },
    },
  };
}

function createActiveReplayFixture(overrides = {}) {
  const activeSession = {
    value: {
      id: "s-1",
      sessionId: "s-1",
      messages: [
        {
          id: "message-1",
          messageId: "message-1",
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
    activeSessionId: { value: "s-1" },
    chatList: { value: [] },
    appliedReconnectSeqByDialogProcessId: {},
    classifyRealtimeLog: vi.fn((logItem) => logItem),
    getReplayHydrationPromise: vi.fn(() => null),
    setReplayHydrationPromise: vi.fn(),
    envelopeCallbacks: {},
    markReconnectSequenceApplied: vi.fn(),
    scrollBottom: vi.fn(),
    ...overrides,
  };
  fixture.findCanonicalMessageById = overrides.findCanonicalMessageById || ((sessionId, messageId) => {
    const targetSessionId = fixture.activeSession.value.sessionId || fixture.activeSession.value.id;
    if (sessionId !== targetSessionId) return null;
    return fixture.activeSession.value.messages.find(
      (message) => (message.messageId || message.id) === messageId,
    ) || null;
  });
  return fixture;
}

function createFakeProcessStore() {
  const events = [];
  return {
    events,
    applyEventBatch: vi.fn((nextEvents = []) => {
      events.push(...nextEvents);
    }),
    getCompatView: vi.fn(() => {
      const logs = events.map((event) => event?.payload?.log).filter(Boolean);
      return {
        realtimeLogs: logs,
        completedToolLogs: logs,
        executionLogTotal: logs.length,
        lastSequence: Math.max(0, ...events.map((event) => Number(event?.sequence || 0))),
      };
    }),
  };
}

describe("replayCacheConsumer", () => {
  it("keeps cached workflow-node replay out of the root message consumer", async () => {
    const childMessages = [{
      event: "subagent_message_event",
      data: { turnScopeId: "workflow-node:node-1", route: { scope: "sub_session" } },
    }];
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
    const replayCache = {
      "s-1": {
        "dp-1": [{ event: StreamEventEnum.DELTA, data: { text: "a", turnScopeId: "turn-1" } }],
        "__session__s-1": [{ event: StreamEventEnum.DELTA, data: { text: "b" } }],
      },
      "s-2": {
        "dp-2": [{ event: StreamEventEnum.DELTA, data: { text: "c" } }],
      },
    };
    const applyReconnectMessagesToActiveSession = vi.fn(async () => {});

    await consumeReconnectReplayCacheForSession({
      replayCache,
      sessionId: " s-1 ",
      applyReconnectMessagesToActiveSession,
    });

    expect(applyReconnectMessagesToActiveSession).toHaveBeenCalledTimes(2);
    expect(applyReconnectMessagesToActiveSession).toHaveBeenNthCalledWith(
      1,
      [{ event: StreamEventEnum.DELTA, data: { text: "a", turnScopeId: "turn-1" } }],
      "dp-1",
      { turnScopeId: "turn-1" },
    );
    expect(applyReconnectMessagesToActiveSession).toHaveBeenNthCalledWith(
      2,
      [{ event: StreamEventEnum.DELTA, data: { text: "b" } }],
      "",
      { turnScopeId: "" },
    );
    expect(replayCache).toEqual({
      "s-2": {
        "dp-2": [{ event: StreamEventEnum.DELTA, data: { text: "c" } }],
      },
    });
  });

  it("marks reconnect sequence only when the incoming sequence is newer", () => {
    const appliedReconnectSeqByDialogProcessId = { "dp-1": 5 };

    markReconnectSequenceApplied(appliedReconnectSeqByDialogProcessId, " dp-1 ", 3);
    markReconnectSequenceApplied(appliedReconnectSeqByDialogProcessId, " dp-1 ", 8);
    markReconnectSequenceApplied(appliedReconnectSeqByDialogProcessId, "", 10);

    expect(appliedReconnectSeqByDialogProcessId).toEqual({ "dp-1": 8 });
  });

  it("skips already applied reconnect envelopes by last applied sequence", async () => {
    const fixture = createActiveReplayFixture({
      appliedReconnectSeqByDialogProcessId: { "dp-1": 2 },
    });

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: " dp-1 ",
      messages: [
        authoritative("llm_delta", 1, { text: "old" }),
        authoritative("llm_delta", 3, { text: "new" }),
      ],
    });

    expect(fixture.activeSession.value.messages[0].content).toBe("new");
    expect(fixture.markReconnectSequenceApplied).toHaveBeenCalledWith("dp-1", 3, expect.objectContaining({
      sessionId: "s-1",
      turnScopeId: "turn-1",
      eventKindsAtSequence: ["message_event"],
    }));
    expect(fixture.scrollBottom).not.toHaveBeenCalled();
  });

  it("keeps replay ordering authoritative without a local terminal state set", async () => {
    const fixture = createActiveReplayFixture();

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      messages: [
        authoritative("llm_delta", 1, { text: "final" }),
        { event: StreamEventEnum.DONE, data: { seq: 2 } },
      ],
    });

    expect(fixture.markReconnectSequenceApplied).toHaveBeenLastCalledWith("dp-1", 2, expect.objectContaining({
      sessionId: "s-1",
      turnScopeId: "turn-1",
      eventKindsAtSequence: [StreamEventEnum.DONE],
    }));
    expect(fixture.activeSession.value.messages[0].content).toBe("final");

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      messages: [
        authoritative("llm_delta", 3, { text: "ignored" }),
      ],
    });

    expect(fixture.activeSession.value.messages[0].content).toBe("final");
    expect(fixture.markReconnectSequenceApplied).toHaveBeenLastCalledWith("dp-1", 3, expect.objectContaining({
      sessionId: "s-1",
      turnScopeId: "turn-1",
      eventKindsAtSequence: ["message_event"],
    }));
  });

  it("projects authoritative reconnect thinking without mutating process display mirrors", async () => {
    const processStore = createFakeProcessStore();
    const hydratedCompletedLogs = Array.from({ length: 12 }, (_, index) => ({
      event: "tool_call",
      text: `old step ${index + 1}`,
      sequence: index + 1,
    }));
    const fixture = createActiveReplayFixture({
      processStore,
      activeSession: {
        value: {
          id: "s-1",
          sessionId: "s-1",
          messages: [
            {
              role: "assistant",
              id: "message-1",
              messageId: "message-1",
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
      messages: [
        authoritative("thinking", 1, { text: "next step" }),
      ],
    });

    const targetMessage = fixture.activeSession.value.messages[0];
    expect(processStore.applyEventBatch).not.toHaveBeenCalled();
    expect(selectActivityTimelineLogs(targetMessage)).toHaveLength(1);
    expect(selectActivityTimelineLogs(targetMessage)[0].text).toContain("next step");
  });

  it("keeps legacy reconnect errors out of canonical messages and process display mirrors", async () => {
    const processStore = createFakeProcessStore();
    const fixture = createActiveReplayFixture({ processStore });

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      messages: [
        {
          event: StreamEventEnum.ERROR,
          data: {
            seq: 9,
            error: "tool failed",
            dialogProcessId: "dp-1",
            executionLogs: [
              { event: "tool_call", text: "run tool", dialogProcessId: "dp-1" },
              { event: "tool_result", text: "tool failed", status: "error", dialogProcessId: "dp-1" },
            ],
          },
        },
      ],
    });

    const targetMessage = fixture.activeSession.value.messages[0];
    expect(targetMessage.error).toBeUndefined();
    expect(processStore.applyEventBatch).not.toHaveBeenCalled();
    expect(targetMessage.processExecutionLogTotal).toBeUndefined();
    expect(targetMessage.processRealtimeLogs).toBeUndefined();
    expect(targetMessage.processCompletedToolLogs).toBeUndefined();
  });

  it("does not let legacy reconnect thinking mutate canonical timelines", async () => {
    const processStore = createFakeProcessStore();
    const fixture = createActiveReplayFixture({ processStore });

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      messages: [
        {
          event: "message",
          data: { seq: 7, text: "searching", event: "tool_call", dialogProcessId: "dp-1" },
        },
      ],
    });

    const targetMessage = fixture.activeSession.value.messages[0];
    expect(processStore.applyEventBatch).not.toHaveBeenCalled();
    expect(selectToolTimelineLogs(targetMessage)).toEqual([]);
    expect(selectActivityTimelineLogs(targetMessage)).toEqual([]);
    expect(targetMessage.processExecutionLogTotal).toBeUndefined();
    expect(targetMessage.processRealtimeLogs).toBeUndefined();
    expect(targetMessage.processCompletedToolLogs).toBeUndefined();
  });

  it("derives the continuation turn from cached envelopes before resolving a reused dialog", async () => {
    const stoppedAssistant = {
      role: "assistant",
      id: "message-stopped",
      messageId: "message-stopped",
      sessionId: "s-1",
      dialogProcessId: "dp-shared",
      turnScopeId: "turn-stopped",
      content: "stopped",
      pending: false,
      realtimeLogs: [],
    };
    const continuationAssistant = {
      role: "assistant",
      id: "message-continuation",
      messageId: "message-continuation",
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
      messages: [authoritative("thinking", 1, {
        messageId: "message-continuation",
        text: "continuation tool",
        dialogProcessId: "dp-shared",
        turnScopeId: "turn-continuation",
      })],
    });

    expect(stoppedAssistant.realtimeLogs).toEqual([]);
    expect(selectToolTimelineLogs(stoppedAssistant)).toEqual([]);
    expect(selectActivityTimelineLogs(stoppedAssistant)).toEqual([]);
    expect(continuationAssistant.turnScopeId).toBe("turn-continuation");
    expect(selectActivityTimelineLogs(continuationAssistant)).toHaveLength(1);
    expect(selectActivityTimelineLogs(continuationAssistant)[0].text).toContain("continuation tool");
  });
});
