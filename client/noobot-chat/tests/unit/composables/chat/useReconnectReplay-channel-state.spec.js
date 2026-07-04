import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixture, createFakeProcessStore } from "./helpers/useReconnectReplayHelper";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("session scoped reconnect channel_state restores elapsed on latest assistant even when refresh did not mark it pending", async () => {
    const { api, refs } = createFixture();
    const startedAt = "2026-06-22T10:00:00.000Z";
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "partial from refreshed detail", pending: false },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "",
      state: "sending",
      createdAt: startedAt,
      createdAtMs: Date.parse(startedAt),
      updatedAt: startedAt,
      updatedAtMs: Date.parse(startedAt),
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(assistant.pending).toBe(true);
    expect(assistant.channelState).toMatchObject({
      state: "sending",
      createdAt: startedAt,
      createdAtMs: Date.parse(startedAt),
    });
    expect(assistant.thinkingStartedAt).toBe(startedAt);
  });

  it("session scoped reconnect channel_state preserves thinking elapsed on latest pending assistant", async () => {
    const { api, refs } = createFixture();
    const startedAt = "2026-06-22T10:00:00.000Z";
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "",
      state: "sending",
      createdAt: startedAt,
      createdAtMs: Date.parse(startedAt),
      updatedAt: startedAt,
      updatedAtMs: Date.parse(startedAt),
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(assistant.channelState).toMatchObject({
      state: "sending",
      createdAt: startedAt,
      createdAtMs: Date.parse(startedAt),
    });
    expect(assistant.thinkingStartedAt).toBe(startedAt);
  });

  it("reconnect channel_state preserves thinking elapsed start on active assistant", async () => {
    const { api, refs } = createFixture();
    const startedAt = "2026-06-22T10:00:00.000Z";
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-reconnect-time", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-reconnect-time",
      state: "sending",
      createdAt: startedAt,
      createdAtMs: Date.parse(startedAt),
      updatedAt: startedAt,
      updatedAtMs: Date.parse(startedAt),
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(assistant.channelState).toMatchObject({
      state: "sending",
      createdAt: startedAt,
      createdAtMs: Date.parse(startedAt),
    });
    expect(assistant.thinkingStartedAt).toBe(startedAt);
    expect(assistant.thinking_started_at).toBeUndefined();
  });

  it("does not apply a stale stopped channel_state to a newer resend placeholder", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "edited", turnScopeId: "client-turn:new" },
      {
        role: RoleEnum.ASSISTANT,
        content: "",
        turnScopeId: "client-turn:new",
        dialogProcessId: "",
        pending: true,
        channelState: { state: "sending", turnScopeId: "client-turn:new" },
      },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-old",
      turnScopeId: "client-turn:old",
      state: "stopped",
      sourceEvent: "stop",
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(assistant.pending).toBe(true);
    expect(assistant.statusLabel).toBeUndefined();
    expect(assistant.channelState).toMatchObject({
      state: "sending",
      turnScopeId: "client-turn:new",
    });
  });

  it("applies live reconnect thinking without sessionId to active process items", async () => {
    const processStore = createFakeProcessStore();
    const { api, refs } = createFixture({ processStore });
    const hydratedLogs = Array.from({ length: 2 }, (_, index) => ({
      event: "tool_call",
      text: `old step ${index + 1}`,
      sequence: index + 1,
    }));
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "dp-live",
        content: "",
        pending: true,
        executionLogTotal: 0,
        processExecutionLogTotal: 2,
        processLastSequence: 2,
        processRealtimeLogs: hydratedLogs,
        processCompletedToolLogs: hydratedLogs,
      },
    ];

    await api.applyReconnectEvent(StreamEventEnum.THINKING, {
      dialogProcessId: "dp-live",
      text: "tool still running",
      event: "tool_call",
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(processStore.applyEventBatch).toHaveBeenCalledTimes(1);
    expect(assistant.executionLogTotal).toBe(3);
    expect(assistant.processExecutionLogTotal).toBe(3);
    expect(assistant.processRealtimeLogs).toHaveLength(3);
    expect(assistant.processRealtimeLogs[2].text).toContain("tool still running");
    expect(assistant.processCompletedToolLogs).toHaveLength(3);
    expect(assistant.processCompletedToolLogs[2].text).toContain("tool still running");
  });

  it("RT-01: applyReconnectData routes active to replay and non-active to replayCache", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          dialogProcesses: [
            {
              dialogProcessId: "dp-a",
              messages: [{ event: StreamEventEnum.DELTA, data: { seq: 1, text: "A", dialogProcessId: "dp-a" } }],
            },
          ],
        },
        {
          sessionId: "s-2",
          dialogProcesses: [
            {
              dialogProcessId: "dp-b",
              messages: [{ event: StreamEventEnum.DELTA, data: { seq: 1, text: "B", dialogProcessId: "dp-b" } }],
            },
          ],
        },
      ],
    });

    const activeAssistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-a",
    );
    expect(activeAssistant?.content).toBe("A");
    expect(api.__test.replayCache["s-2"]["dp-b"]).toHaveLength(1);
  });

  it("RT-03: non-active realtime event writes cache only", async () => {
    const { api, refs, mocks } = createFixture();
    const beforeCount = refs.activeSession.value.messages.length;

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-2",
      dialogProcessId: "dp-x",
      seq: 1,
      text: "hello",
    });

    expect(refs.activeSessionId.value).toBe("s-1");
    expect(refs.activeSession.value.messages).toHaveLength(beforeCount);
    expect(api.__test.replayCache["s-2"]["dp-x"]).toHaveLength(1);
    expect(mocks.chatList.selectSession).not.toHaveBeenCalled();
  });

  it("RT-02: active realtime event applies directly and does not write replayCache", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-active",
      seq: 1,
      text: "hello",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-active",
    );
    expect(assistant?.content).toBe("hello");
    expect(api.__test.replayCache["s-1"]).toBeUndefined();
  });

  it("RT-04: cached events are consumed after session switch without duplicate apply", async () => {
    const { api, refs } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-2",
      dialogProcessId: "dp-2",
      seq: 1,
      text: "A",
    });

    refs.activeSessionId.value = "s-2";
    refs.activeSession.value = refs.sessions.value.find((s) => s.id === "s-2");

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-2",
      dialogProcessId: "dp-2",
      seq: 2,
      text: "B",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-2",
    );
    expect(assistant?.content).toBe("AB");
    expect(api.__test.replayCache["s-2"]).toBeUndefined();
  });

  it("RT-05: reconnect conversationStates can restore sending=true", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          conversationStates: [
            {
              sessionId: "s-1",
              dialogProcessId: "dp-state",
              state: "sending",
              seq: 9,
            },
          ],
          dialogProcesses: [],
        },
      ],
    });

    expect(refs.sending.value).toBe(true);
  });

  it("EV-03e: connector_status is informational and should not create pending interaction", async () => {
    const { api, refs, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CONNECTOR_STATUS, {
      sessionId: "s-1",
      dialogProcessId: "dp-connector-status",
      connectorType: "email",
      connectorName: "example_email",
      status: "connected",
    });

    expect(mocks.upsertConnectedConnectorInPanelState).toHaveBeenCalledWith(
      refs.activeSession.value,
      {
        connectorType: "email",
        connectorName: "example_email",
        status: "connected",
      },
    );
    expect(mocks.refreshSessionConnectorsAsync).toHaveBeenCalledWith("s-1");
    expect(mocks.setPendingInteractionRequest).not.toHaveBeenCalled();
  });

  it("RT-06: expired state clears pending interaction and stops sending", async () => {
    const { api, refs, mocks } = createFixture();
    refs.sending.value = true;
    refs.interactionSubmitting.value = true;

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          conversationStates: [
            {
              sessionId: "s-1",
              dialogProcessId: "dp-expired",
              state: "expired",
              seq: 11,
            },
          ],
          dialogProcesses: [],
        },
      ],
    });

    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteraction).toHaveBeenCalled();
  });

  it.each(["cancelled"])(
    "RT-06b: %s state clears pending interaction and stops sending",
    async (state) => {
      const { api, refs, mocks } = createFixture();
      refs.sending.value = true;
      refs.interactionSubmitting.value = true;

      await api.applyReconnectData({
        sessions: [
          {
            sessionId: "s-1",
            conversationStates: [
              {
                sessionId: "s-1",
                dialogProcessId: `dp-${state}`,
                state,
                seq: 12,
              },
            ],
            dialogProcesses: [],
          },
        ],
      });

      expect(refs.sending.value).toBe(false);
      expect(refs.interactionSubmitting.value).toBe(false);
      expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
        sessionId: "s-1",
        dialogProcessId: `dp-${state}`,
      });
    },
  );
});
