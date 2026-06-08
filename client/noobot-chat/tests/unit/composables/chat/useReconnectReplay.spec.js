import { effectScope, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReconnectReplay } from "../../../../src/composables/chat/useReconnectReplay";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

function createSession(id) {
  return {
    id,
    backendSessionId: id,
    title: `session-${id}`,
    loaded: true,
    messages: [],
    rawMessages: [],
    sessionDocs: [],
    messageCount: 0,
    lastMessage: null,
    updatedAt: "",
  };
}

function createFixture({ activeId = "s-1" } = {}) {
  const s1 = createSession("s-1");
  const s2 = createSession("s-2");
  const sessions = ref([s1, s2]);
  const activeSessionId = ref(activeId);
  const activeSession = ref(sessions.value.find((s) => s.id === activeId));
  const sending = ref(true);
  const interactionSubmitting = ref(true);
  const pendingInteractionRequest = ref(null);

  const clearPendingInteraction = vi.fn();
  const clearPendingInteractionIfObsolete = vi.fn();
  const setPendingInteractionRequest = vi.fn();
  const upsertConnectedConnectorInPanelState = vi.fn();
  const refreshSessionConnectorsAsync = vi.fn();
  const applyCompletedToolLogsToMessages = vi.fn();
  const scrollBottom = vi.fn();
  const notify = vi.fn();

  const chatList = {
    fetchSessions: vi.fn(async () => {}),
    selectSession: vi.fn(async (id) => {
      const found = sessions.value.find((sessionItem) => sessionItem.id === id);
      if (found) {
        activeSessionId.value = id;
        activeSession.value = found;
      }
    }),
  };

  const chatWebSocketClient = {
    clearStopRequested: vi.fn(),
  };

  const appendMessage = vi.fn((role, content = "") => {
    const msg = { role, content, pending: false, statusLabel: "", realtimeLogs: [] };
    activeSession.value.messages.push(msg);
    activeSession.value.rawMessages.push(msg);
    return msg;
  });

  const api = useReconnectReplay({
    sessions,
    activeSession,
    activeSessionId,
    sending,
    interactionSubmitting,
    chatList,
    chatWebSocketClient,
    appendMessage,
    makeViewMessage: (message) => ({ ...message }),
    foldMessagesForView: (messages) => [...messages],
    applyCompletedToolLogsToMessages,
    sessionTitleFromMessages: () => "session",
    pendingInteractionRequest,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    isInteractionRequestHandled: vi.fn(() => false),
    connectorTypeSet: new Set(["email"]),
    upsertConnectedConnectorInPanelState,
    refreshSessionConnectorsAsync,
    classifyRealtimeLog: (item) => item,
    scrollBottom,
    translate: (key) => key,
    notify,
  });

  return {
    api,
    refs: {
      sessions,
      activeSession,
      activeSessionId,
      sending,
      interactionSubmitting,
      pendingInteractionRequest,
    },
    mocks: {
      appendMessage,
      clearPendingInteraction,
      clearPendingInteractionIfObsolete,
      setPendingInteractionRequest,
      upsertConnectedConnectorInPanelState,
      refreshSessionConnectorsAsync,
      applyCompletedToolLogsToMessages,
      scrollBottom,
      notify,
      chatList,
      chatWebSocketClient,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
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

  it("SQ-02/SQ-03: out-of-order and duplicate sequence are deduplicated", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-1", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      seq: 3,
      text: "C",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      seq: 1,
      text: "A",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      seq: 2,
      text: "B",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      seq: 2,
      text: "B2",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-1",
    );
    expect(assistant?.content).toBe("C");
    expect(api.__test.appliedReconnectSeqByDialogProcessId["dp-1"]).toBe(3);
  });

  it("SQ-04: sequence gap is allowed and progresses watermark", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-gap", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-gap",
      seq: 5,
      text: "X",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-gap",
      seq: 6,
      text: "Y",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-gap",
    );
    expect(assistant?.content).toBe("XY");
    expect(api.__test.appliedReconnectSeqByDialogProcessId["dp-gap"]).toBe(6);
  });

  it("SQ-01: increasing sequence applies in order and records max sequence", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-inc", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-inc",
      seq: 1,
      text: "A",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-inc",
      seq: 2,
      text: "B",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-inc",
      seq: 3,
      text: "C",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-inc",
    );
    expect(assistant?.content).toBe("ABC");
    expect(api.__test.appliedReconnectSeqByDialogProcessId["dp-inc"]).toBe(3);
  });

  it("EV-02: THINKING updates logs and keeps pending true", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-t", content: "", pending: true, realtimeLogs: [] },
    ];

    await api.applyReconnectEvent(StreamEventEnum.THINKING, {
      sessionId: "s-1",
      dialogProcessId: "dp-t",
      seq: 1,
      dialogProcessIdFromLog: "dp-t",
      text: "thinking",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-t",
    );
    expect(assistant?.pending).toBe(true);
    expect(assistant?.realtimeLogs?.length).toBe(1);
  });

  it("EV-01: DELTA appends content and keeps pending unchanged", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-delta", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-delta",
      seq: 1,
      text: "A",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-delta",
      seq: 2,
      text: "B",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-delta",
    );
    expect(assistant?.content).toBe("AB");
    expect(assistant?.pending).toBe(true);
  });

  it("EV-01c: replay in-flight DELTA does not restore sending without channel_state", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-sending",
      seq: 1,
      text: "A",
    });

    expect(refs.sending.value).toBe(false);
  });

  it("EV-01d: channel_state sending event restores sending=true", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-cs",
      state: "sending",
      seq: 11,
    });

    expect(refs.sending.value).toBe(true);
  });

  it("EV-01e: channel_state reconnecting keeps sending=true", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "",
      state: "reconnecting",
      seq: 12,
    });

    expect(refs.sending.value).toBe(true);
  });

  it("EV-01f: channel_state stopping keeps sending=true and marks assistant status", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-stop", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stop",
      state: "stopping",
      seq: 12,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-stop",
    );
    expect(refs.sending.value).toBe(true);
    expect(assistant?.statusLabel).toBe("chat.stopping");
    expect(assistant?.pending).toBe(true);
  });

  it("EV-02b: replay in-flight THINKING does not restore sending without channel_state", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectEvent(StreamEventEnum.THINKING, {
      sessionId: "s-1",
      dialogProcessId: "dp-thinking",
      seq: 1,
      text: "thinking",
    });

    expect(refs.sending.value).toBe(false);
  });

  it("EV-01b: when current turn has no user, render session first then replay", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "old-q", ts: 1 },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old-a", ts: 2, pending: false },
    ];
    refs.activeSession.value.rawMessages = [...refs.activeSession.value.messages];

    mocks.chatList.fetchSessionDetail = vi.fn(async () => ({
      sessionId: "s-1",
      sessions: [
        {
          sessionId: "s-1",
          messages: [
            { role: RoleEnum.USER, content: "old-q", ts: 1 },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old-a", ts: 2 },
            { role: RoleEnum.USER, content: "new-q", ts: 3 },
          ],
        },
      ],
    }));
    mocks.chatList.applySessionDetail = vi.fn((detail) => {
      const main = (detail?.sessions || [])[0] || {};
      refs.activeSession.value.messages = (main.messages || []).map((message) => ({ ...message }));
      refs.activeSession.value.rawMessages = [...refs.activeSession.value.messages];
    });

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-new",
      seq: 1,
      text: "A",
    });

    const userIdx = refs.activeSession.value.messages.findIndex(
      (message) => message.role === RoleEnum.USER && message.content === "new-q",
    );
    const assistantIdx = refs.activeSession.value.messages.findIndex(
      (message) =>
        message.role === RoleEnum.ASSISTANT &&
        message.dialogProcessId === "dp-new" &&
        message.content === "A",
    );
    expect(mocks.chatList.fetchSessionDetail).toHaveBeenCalledTimes(1);
    expect(mocks.chatList.applySessionDetail).toHaveBeenCalledTimes(1);
    expect(userIdx).toBeGreaterThan(-1);
    expect(assistantIdx).toBeGreaterThan(userIdx);
  });

  it("EV-03: INTERACTION_REQUEST sets pending interaction without terminal cleanup", async () => {
    const { api, refs, mocks } = createFixture();
    refs.interactionSubmitting.value = false;
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-int", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      sessionId: "s-1",
      dialogProcessId: "dp-int",
      seq: 1,
      requestId: "req-1",
      interactionType: "confirm",
    });

    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
    expect(refs.interactionSubmitting.value).toBe(false);
  });

  it("EV-03b: non-interaction replay event does not clear interaction without channel_state", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-int2", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      sessionId: "s-1",
      dialogProcessId: "dp-int2",
      seq: 1,
      requestId: "req-2",
      interactionType: "confirm",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-int2",
      seq: 2,
      text: "resume",
    });

    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
  });

  it("EV-03b2: auto-resolved interaction replay does not enter pending", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      sessionId: "s-1",
      dialogProcessId: "dp-int2-auto",
      seq: 1,
      requestId: "req-2-auto",
      interactionType: "post_action_notice",
      lifecycle: "resolved",
      ackMode: "auto",
    });

    expect(mocks.setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteraction).toHaveBeenCalled();
  });

  it("EV-03c: channel_state completed clears obsolete interaction for same turn", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int3",
      state: "completed",
      seq: 12,
    });

    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-int3",
    });
  });

  it("EV-03d: channel_state interaction_pending restores pending interaction payload", async () => {
    const { api, refs, mocks } = createFixture();
    refs.interactionSubmitting.value = false;

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int4",
      state: "interaction_pending",
      seq: 13,
      pendingInteraction: {
        requestId: "req-4",
        sessionId: "s-1",
        dialogProcessId: "dp-int4",
        interactionType: "confirm",
        content: "need confirm",
      },
    });

    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(mocks.setPendingInteractionRequest.mock.calls[0][0]).toMatchObject({
      requestId: "req-4",
      sessionId: "s-1",
      dialogProcessId: "dp-int4",
      interactionType: "confirm",
      content: "need confirm",
    });
  });

  it("EV-03e: channel_state sending only clears interaction when sourceEvent=interaction_response", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int5",
      state: "sending",
      seq: 14,
    });
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int5",
      state: "sending",
      sourceEvent: "interaction_response",
      requestId: "req-int5",
      seq: 15,
    });
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledTimes(1);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      requestId: "req-int5",
    });
  });

  it("EV-06/FN-01: channel_state error finalizes terminal state", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-e", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.ERROR, {
      sessionId: "s-1",
      dialogProcessId: "dp-e",
      seq: 2,
      error: "boom",
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-e",
      state: "error",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-e",
    );
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("boom");
    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-e",
    });
    expect(mocks.chatWebSocketClient.clearStopRequested).toHaveBeenCalledTimes(1);
  });

  it("EV-04: channel_state completed sets terminal ui fields", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-done", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-done",
      seq: 2,
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-done",
      state: "completed",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-done",
    );
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.generated");
    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-done",
    });
  });

  it("EV-05: channel_state stopped sets stopped status", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-stopped", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.STOPPED, {
      sessionId: "s-1",
      dialogProcessId: "dp-stopped",
      seq: 2,
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stopped",
      state: "stopped",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-stopped",
    );
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.stopped");
    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-stopped",
    });
  });

  it("RC-04: terminal event blocks subsequent DELTA mutation", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-terminal", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal",
      seq: 1,
      text: "A",
    });
    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal",
      seq: 2,
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal",
      seq: 3,
      text: "B",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-terminal",
    );
    expect(assistant?.content).toBe("A");
  });

  it("FN-02: cacheExpired timer refreshes sessions and clears replayCache", async () => {
    vi.useFakeTimers();
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-2",
      dialogProcessId: "dp-cache",
      seq: 1,
      text: "X",
    });
    expect(api.__test.replayCache["s-2"]).toBeTruthy();

    await api.applyReconnectData({ sessions: [], cacheExpired: true });
    vi.advanceTimersByTime(1200);
    await Promise.resolve();

    expect(mocks.chatList.fetchSessions).toHaveBeenCalledWith("s-1", {
      silent: true,
      preserveCurrentMessages: true,
    });
    expect(api.__test.replayCache["s-2"]).toBeUndefined();
  });

  it("FN-02b: channel_state expired triggers silent refresh timer", async () => {
    vi.useFakeTimers();
    const { api, mocks } = createFixture();
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-exp",
      state: "expired",
      seq: 15,
    });

    vi.advanceTimersByTime(1200);
    await Promise.resolve();

    expect(mocks.chatList.fetchSessions).toHaveBeenCalledWith("s-1", {
      silent: true,
      preserveCurrentMessages: true,
    });
  });

  it("FN-02c: channel_state no_conversation clears pending interaction", async () => {
    const { api, refs, mocks } = createFixture();
    refs.sending.value = true;
    refs.interactionSubmitting.value = true;

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-none",
      state: "no_conversation",
      seq: 16,
    });

    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteraction).toHaveBeenCalled();
  });

  it("FN-03: timer is cleaned on scope dispose", async () => {
    vi.useFakeTimers();
    let api;
    let chatList;
    const scope = effectScope();
    scope.run(() => {
      const fixture = createFixture();
      api = fixture.api;
      chatList = fixture.mocks.chatList;
    });

    await api.applyReconnectData({ sessions: [], cacheExpired: true });
    scope.stop();
    vi.advanceTimersByTime(1200);
    await Promise.resolve();

    expect(chatList.fetchSessions).not.toHaveBeenCalled();
  });

  it.each([
    StreamEventEnum.DONE,
    StreamEventEnum.STOPPED,
    StreamEventEnum.ERROR,
  ])("FN-01: %s duplicate replay does not trigger terminal cleanup without channel_state", async (terminalEvent) => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-once", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(terminalEvent, {
      sessionId: "s-1",
      dialogProcessId: "dp-once",
      seq: 2,
      ...(terminalEvent === StreamEventEnum.ERROR ? { error: "boom" } : {}),
    });
    await api.applyReconnectEvent(terminalEvent, {
      sessionId: "s-1",
      dialogProcessId: "dp-once",
      seq: 2,
      ...(terminalEvent === StreamEventEnum.ERROR ? { error: "boom" } : {}),
    });

    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
    expect(mocks.chatWebSocketClient.clearStopRequested).not.toHaveBeenCalled();
  });

  it("RC-05: missing dialogProcessId does not throw and uses safe cache key", async () => {
    const { api } = createFixture();

    await expect(
      api.applyReconnectEvent(StreamEventEnum.DELTA, {
        sessionId: "s-2",
        seq: 1,
        text: "no-dp",
      }),
    ).resolves.toBeUndefined();

    const cacheKeys = Object.keys(api.__test.replayCache["s-2"] || {});
    expect(cacheKeys.some((key) => key.startsWith("__session__"))).toBe(true);
  });

  it("RC-01: rapid session switching does not apply replay to wrong session", async () => {
    const { api, refs } = createFixture();
    refs.sessions.value.find((session) => session.id === "s-1").messages = [
      { role: RoleEnum.USER, content: "s1-q" },
    ];
    refs.sessions.value.find((session) => session.id === "s-2").messages = [
      { role: RoleEnum.USER, content: "s2-q" },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-2",
      dialogProcessId: "dp-s2",
      seq: 1,
      text: "A",
    });

    refs.activeSessionId.value = "s-2";
    refs.activeSession.value = refs.sessions.value.find((s) => s.id === "s-2");

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-2",
      dialogProcessId: "dp-s2",
      seq: 2,
      text: "B",
    });

    refs.activeSessionId.value = "s-1";
    refs.activeSession.value = refs.sessions.value.find((s) => s.id === "s-1");

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-s1",
      seq: 1,
      text: "C",
    });

    const s1Assistant = refs.sessions.value
      .find((session) => session.id === "s-1")
      .messages.find((message) => message.dialogProcessId === "dp-s1");
    const s2Assistant = refs.sessions.value
      .find((session) => session.id === "s-2")
      .messages.find((message) => message.dialogProcessId === "dp-s2");

    expect(s1Assistant?.content).toBe("C");
    expect(s2Assistant?.content).toBe("AB");
  });

  it("RC-02: applyReconnectData + realtime event mixed replay still deduplicates by sequence", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          dialogProcesses: [
            {
              dialogProcessId: "dp-mix",
              messages: [
                { event: StreamEventEnum.DELTA, data: { seq: 1, text: "A", dialogProcessId: "dp-mix" } },
                { event: StreamEventEnum.DELTA, data: { seq: 2, text: "B", dialogProcessId: "dp-mix" } },
              ],
            },
          ],
        },
      ],
    });

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-mix",
      seq: 2,
      text: "B2",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-mix",
      seq: 3,
      text: "C",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-mix",
    );
    expect(assistant?.content).toBe("ABC");
    expect(api.__test.appliedReconnectSeqByDialogProcessId["dp-mix"]).toBe(3);
  });

  it("RC-03: large reconnect batch (>1000 envelopes) can be applied without crash", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];
    const bigBatch = Array.from({ length: 1200 }).map((_, index) => ({
      event: StreamEventEnum.DELTA,
      data: {
        seq: index + 1,
        text: "x",
        dialogProcessId: "dp-big",
      },
    }));

    await expect(
      api.applyReconnectData({
        sessions: [
          {
            sessionId: "s-1",
            dialogProcesses: [{ dialogProcessId: "dp-big", messages: bigBatch }],
          },
        ],
      }),
    ).resolves.toBeUndefined();

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-big",
    );
    expect(assistant?.content?.length).toBe(1200);
    expect(api.__test.appliedReconnectSeqByDialogProcessId["dp-big"]).toBe(1200);
  });

  it("副作用顺序: appendMessage -> scrollBottom; terminal cleanup由channel_state触发", async () => {
    const { api, mocks } = createFixture();
    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          dialogProcesses: [
            {
              dialogProcessId: "dp-order",
              messages: [
                { event: StreamEventEnum.DELTA, data: { seq: 1, text: "A", dialogProcessId: "dp-order" } },
                { event: StreamEventEnum.ERROR, data: { seq: 2, error: "x", dialogProcessId: "dp-order" } },
              ],
            },
          ],
          conversationStates: [
            { sessionId: "s-1", dialogProcessId: "dp-order", state: "error", seq: 3 },
          ],
        },
      ],
    });

    expect(mocks.appendMessage).toHaveBeenCalled();
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalled();
    expect(mocks.scrollBottom).toHaveBeenCalled();
  });

  it("interaction_pending without pendingInteraction falls back to error state", async () => {
    vi.useFakeTimers();
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "", pending: true, statusLabel: "" },
    ];

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          conversationStates: [
            {
              sessionId: "s-1",
              dialogProcessId: "dp-missing",
              state: "interaction_pending",
              seq: 10,
            },
          ],
          dialogProcesses: [],
        },
      ],
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT,
    );
    expect(refs.sending.value).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect(refs.sending.value).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.interactionPayloadMissing");
    expect(mocks.notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.interactionPayloadMissing",
    });
    vi.useRealTimers();
  });

  it("interaction_pending without pendingInteraction waits for later interaction_request", async () => {
    vi.useFakeTimers();
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "", pending: true, statusLabel: "" },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-late",
      state: "interaction_pending",
      seq: 10,
    });
    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      requestId: "req-late",
      sessionId: "s-1",
      dialogProcessId: "dp-late",
      interactionType: "confirm",
      content: "continue?",
    });

    await vi.advanceTimersByTimeAsync(1200);

    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-late",
        dialogProcessId: "dp-late",
      }),
    );
    expect(refs.sending.value).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("expired refresh failure falls back to error state", async () => {
    vi.useFakeTimers();
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "", pending: true, statusLabel: "" },
    ];
    mocks.chatList.fetchSessions.mockResolvedValue(false);

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

    await vi.advanceTimersByTimeAsync(1300);

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT,
    );
    expect(refs.sending.value).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.expiredRefreshFailed");
    expect(mocks.notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.expiredRefreshFailed",
    });
    vi.useRealTimers();
  });
});
