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
} from "../../../../src/composables/chat/reconnectReplay/replayCacheConsumer";
import { StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

function createActiveReplayFixture(overrides = {}) {
  const activeSession = {
    value: {
      messages: [
        { role: "assistant", dialogProcessId: "dp-1", content: "", pending: true },
      ],
    },
  };

  return {
    activeSession,
    activeSessionId: { value: "s-1" },
    appendMessage: vi.fn((message) => activeSession.value.messages.push(message)),
    chatList: { value: [] },
    appliedReconnectSeqByDialogProcessId: {},
    terminalDialogProcessIdSet: new Set(),
    classifyRealtimeLog: vi.fn((logItem) => logItem),
    getReplayHydrationPromise: vi.fn(() => null),
    setReplayHydrationPromise: vi.fn(),
    applyDoneMessages: vi.fn(),
    envelopeCallbacks: {},
    markReconnectSequenceApplied: vi.fn(),
    scrollBottom: vi.fn(),
    ...overrides,
  };
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
  it("consumes cached replay groups for a session and removes the session cache", async () => {
    const replayCache = {
      "s-1": {
        "dp-1": [{ event: StreamEventEnum.DELTA, data: { text: "a" } }],
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
      [{ event: StreamEventEnum.DELTA, data: { text: "a" } }],
      "dp-1",
    );
    expect(applyReconnectMessagesToActiveSession).toHaveBeenNthCalledWith(
      2,
      [{ event: StreamEventEnum.DELTA, data: { text: "b" } }],
      "",
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
        { event: StreamEventEnum.DELTA, data: { seq: 1, text: "old" } },
        { event: StreamEventEnum.DELTA, data: { seq: 3, text: "new" } },
      ],
    });

    expect(fixture.activeSession.value.messages[0].content).toBe("new");
    expect(fixture.markReconnectSequenceApplied).toHaveBeenCalledWith("dp-1", 3);
    expect(fixture.scrollBottom).not.toHaveBeenCalled();
  });

  it("marks terminal reconnect batches and ignores later non-terminal replay for that dialog process", async () => {
    const terminalDialogProcessIdSet = new Set();
    const fixture = createActiveReplayFixture({ terminalDialogProcessIdSet });

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      messages: [
        { event: StreamEventEnum.DELTA, data: { seq: 1, text: "final" } },
        { event: StreamEventEnum.DONE, data: { seq: 2 } },
      ],
    });

    expect(terminalDialogProcessIdSet.has("dp-1")).toBe(true);
    expect(fixture.markReconnectSequenceApplied).toHaveBeenLastCalledWith("dp-1", 2);
    expect(fixture.activeSession.value.messages[0].content).toBe("final");

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      messages: [
        { event: StreamEventEnum.DELTA, data: { seq: 3, text: "ignored" } },
      ],
    });

    expect(fixture.activeSession.value.messages[0].content).toBe("final");
    expect(fixture.markReconnectSequenceApplied).toHaveBeenLastCalledWith("dp-1", 3);
  });

  it("continues reconnect thinking execution count and items from refresh hydrated process fields", async () => {
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
          messages: [
            {
              role: "assistant",
              dialogProcessId: "dp-1",
              content: "",
              pending: true,
              executionLogTotal: 0,
              processExecutionLogTotal: 12,
              processLastSequence: 12,
              processRealtimeLogs: hydratedCompletedLogs.slice(-10),
              processCompletedToolLogs: hydratedCompletedLogs,
            },
          ],
        },
      },
    });

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      messages: [
        {
          event: StreamEventEnum.THINKING,
          data: { text: "next step", event: "tool_call", dialogProcessId: "dp-1" },
        },
      ],
    });

    const targetMessage = fixture.activeSession.value.messages[0];
    expect(processStore.applyEventBatch).toHaveBeenCalledTimes(1);
    expect(targetMessage.executionLogTotal).toBe(13);
    expect(targetMessage.processExecutionLogTotal).toBe(13);
    expect(targetMessage.processLastSequence).toBe(13);
    expect(processStore.events[0].sequence).toBe(13);
    expect(targetMessage.processRealtimeLogs).toHaveLength(10);
    expect(targetMessage.processRealtimeLogs[0].text).toContain("old step 4");
    expect(targetMessage.processRealtimeLogs[9].text).toContain("next step");
    expect(targetMessage.processCompletedToolLogs).toHaveLength(13);
    expect(targetMessage.processCompletedToolLogs[0].text).toContain("old step 1");
    expect(targetMessage.processCompletedToolLogs[12].text).toContain("next step");
  });

  it("syncs reconnect error execution logs into process compat fields", async () => {
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
    expect(targetMessage.error).toBe("tool failed");
    expect(processStore.applyEventBatch).toHaveBeenCalledTimes(1);
    expect(targetMessage.processExecutionLogTotal).toBe(2);
    expect(targetMessage.processLastSequence).toBe(11);
    expect(targetMessage.processRealtimeLogs).toHaveLength(2);
    expect(targetMessage.processRealtimeLogs[1].text).toContain("tool failed");
    expect(targetMessage.processCompletedToolLogs).toHaveLength(2);
  });

  it("syncs reconnect thinking events into process compat fields after refresh", async () => {
    const processStore = createFakeProcessStore();
    const fixture = createActiveReplayFixture({ processStore });

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      messages: [
        {
          event: StreamEventEnum.THINKING,
          data: { seq: 7, text: "searching", event: "tool_call", dialogProcessId: "dp-1" },
        },
      ],
    });

    const targetMessage = fixture.activeSession.value.messages[0];
    expect(processStore.applyEventBatch).toHaveBeenCalledTimes(1);
    expect(targetMessage.executionLogTotal).toBe(1);
    expect(targetMessage.processExecutionLogTotal).toBe(1);
    expect(targetMessage.processLastSequence).toBe(7);
    expect(targetMessage.processRealtimeLogs[0].text).toContain("searching");
    expect(targetMessage.processCompletedToolLogs[0].text).toContain("searching");
  });
});
