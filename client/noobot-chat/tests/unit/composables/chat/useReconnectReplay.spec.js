import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useReconnectReplay } from "../../../../src/composables/chat/useReconnectReplay";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

function createFixture() {
  const session = {
    id: "s-1",
    backendSessionId: "s-1",
    title: "session",
    loaded: true,
    messages: [],
    rawMessages: [],
    sessionDocs: [],
    messageCount: 0,
    lastMessage: null,
    updatedAt: "",
  };
  const sessions = ref([session]);
  const activeSession = ref(session);
  const activeSessionId = ref("s-1");
  const sending = ref(true);
  const interactionSubmitting = ref(true);

  const clearPendingInteraction = vi.fn();
  const setPendingInteractionRequest = vi.fn();
  const chatList = {
    fetchSessions: vi.fn(async () => {}),
    selectSession: vi.fn(async () => {}),
  };
  const chatWebSocketClient = {
    clearStopRequested: vi.fn(),
  };

  const appendMessage = (role, content = "") => {
    const msg = { role, content, pending: false, statusLabel: "", realtimeLogs: [] };
    activeSession.value.messages.push(msg);
    activeSession.value.rawMessages.push(msg);
    return msg;
  };

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
    applyCompletedToolLogsToMessages: vi.fn(),
    sessionTitleFromMessages: () => "session",
    clearPendingInteraction,
    setPendingInteractionRequest,
    isInteractionRequestHandled: vi.fn(() => false),
    classifyRealtimeLog: (item) => item,
    scrollBottom: vi.fn(),
    translate: (key) => key,
  });

  return {
    api,
    refs: { sessions, activeSession, activeSessionId, sending, interactionSubmitting },
    mocks: {
      clearPendingInteraction,
      setPendingInteractionRequest,
      chatList,
      chatWebSocketClient,
    },
  };
}

describe("useReconnectReplay", () => {
  it("reconnect DONE only patches target dialogProcessId and finalizes sending state", async () => {
    const fixture = createFixture();
    const { api, refs, mocks } = fixture;
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "old q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old keep" },
      { role: RoleEnum.USER, content: "new q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-new", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-new",
      messages: [
        { role: RoleEnum.USER, content: "old q" },
        { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old overwritten" },
        { role: RoleEnum.USER, content: "new q" },
        { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-new", content: "new final" },
      ],
    });

    const oldAssistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-old",
    );
    const newAssistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-new",
    );

    expect(oldAssistant.content).toBe("old keep");
    expect(newAssistant.content).toBe("new final");
    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.chatWebSocketClient.clearStopRequested).toHaveBeenCalledTimes(1);
  });

  it("interaction_request replay deduplicates through isInteractionRequestHandled", async () => {
    const fixture = createFixture();
    const { refs, mocks } = fixture;
    const isHandled = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const api = useReconnectReplay({
      sessions: refs.sessions,
      activeSession: refs.activeSession,
      activeSessionId: refs.activeSessionId,
      sending: refs.sending,
      interactionSubmitting: refs.interactionSubmitting,
      chatList: mocks.chatList,
      chatWebSocketClient: mocks.chatWebSocketClient,
      appendMessage: (role, content = "") => ({ role, content, pending: true, statusLabel: "" }),
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      applyCompletedToolLogsToMessages: vi.fn(),
      sessionTitleFromMessages: () => "session",
      clearPendingInteraction: mocks.clearPendingInteraction,
      setPendingInteractionRequest: mocks.setPendingInteractionRequest,
      isInteractionRequestHandled: isHandled,
      classifyRealtimeLog: (item) => item,
      scrollBottom: vi.fn(),
      translate: (key) => key,
    });

    const eventData = { sessionId: "s-1", requestId: "req-1", interactionType: "confirm" };
    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, eventData);
    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, eventData);

    expect(isHandled).toHaveBeenCalledTimes(2);
    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledTimes(1);
  });

  it("cacheExpired schedules silent session refresh", async () => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture();
      const { api, refs, mocks } = fixture;
      refs.activeSessionId.value = "s-1";

      await api.applyReconnectData({ sessions: [], cacheExpired: true });
      expect(mocks.chatList.fetchSessions).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1200);
      await Promise.resolve();

      expect(mocks.chatList.fetchSessions).toHaveBeenCalledWith("s-1", {
        silent: true,
        preserveCurrentMessages: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
