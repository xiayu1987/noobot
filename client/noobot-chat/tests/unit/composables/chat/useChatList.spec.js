import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useChatList } from "../../../../src/composables/chat/useChatList";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

vi.mock("../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key) => key,
  }),
}));

function createUseChatListFixture(overrides = {}) {
  const userId = ref("u-1");
  const connected = ref(true);
  const ensureConnected = vi.fn(() => true);
  const sessions = ref([]);
  const activeSessionId = ref("");
  const loadingSessions = ref(false);
  const loadingSessionDetail = ref(false);
  const sending = ref(false);
  const notify = vi.fn();
  const scrollBottom = vi.fn();

  const getSessionsApi = overrides.getSessionsApi || vi.fn();
  const getSessionDetailApi = overrides.getSessionDetailApi || vi.fn();

  const api = useChatList({
    userId,
    connected,
    ensureConnected,
    authFetch: null,
    sessions,
    activeSessionId,
    loadingSessions,
    loadingSessionDetail,
    sending,
    createConnectorPanelState: () => ({ selectedConnectors: {} }),
    generateSessionId: () => "local-generated",
    sessionTitleFromMessages: (messages, fallback = "") =>
      messages?.[0]?.content || fallback || "title",
    applyCompletedToolLogsToMessages: vi.fn(),
    getSessionsApi,
    getSessionDetailApi,
    deleteSessionApi: vi.fn(),
    makeViewMessage: (message) => ({ ...message }),
    foldMessagesForView: (messages) => [...messages],
    scrollBottom,
    refreshSessionConnectorsAsync: vi.fn(),
    clearUploads: vi.fn(),
    notify,
  });

  return {
    api,
    refs: {
      sessions,
      activeSessionId,
      loadingSessions,
      loadingSessionDetail,
      sending,
    },
    mocks: { getSessionsApi, getSessionDetailApi, notify, scrollBottom },
  };
}

describe("useChatList", () => {
  it("fetchSessions keeps current session object/message references and uses splice update", async () => {
    const fixture = createUseChatListFixture();
    const { api, refs, mocks } = fixture;
    const existingMessages = [{ role: RoleEnum.USER, content: "local" }];
    const existingSession = {
      id: "local-1",
      backendSessionId: "backend-1",
      title: "old",
      isLocal: true,
      loaded: true,
      messages: existingMessages,
      rawMessages: existingMessages,
      sessionDocs: [{ sessionId: "backend-1", messages: [] }],
      connectorPanelState: { selectedConnectors: {} },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: 1,
      lastMessage: existingMessages[0],
    };

    refs.sessions.value.push(existingSession);
    refs.activeSessionId.value = "local-1";
    const sessionsArrayRef = refs.sessions.value;
    const existingSessionRef = refs.sessions.value[0];
    const existingMessagesRef = refs.sessions.value[0].messages;

    mocks.getSessionsApi.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessions: [
          {
            sessionId: "backend-1",
            caller: RoleEnum.USER,
            createdAt: "2026-05-14T00:00:00.000Z",
            updatedAt: "2026-05-14T00:01:00.000Z",
            messages: [{ role: RoleEnum.USER, content: "server-summary" }],
          },
        ],
      }),
    });
    mocks.getSessionDetailApi.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        exists: true,
        sessionId: "backend-1",
        sessions: [{ sessionId: "backend-1", messages: [] }],
      }),
    });

    await api.fetchSessions("local-1", {
      silent: true,
      preserveCurrentMessages: true,
    });

    expect(refs.sessions.value).toBe(sessionsArrayRef);
    expect(refs.sessions.value[0]).toBe(existingSessionRef);
    expect(refs.sessions.value[0].messages).toBe(existingMessagesRef);
    expect(refs.activeSessionId.value).toBe("backend-1");
  });

  it("fetchSessions with silent=true does not enable loadingSessions flag", async () => {
    const getSessionsApi = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        sessions: [
          {
            sessionId: "backend-2",
            caller: RoleEnum.USER,
            createdAt: "2026-05-14T00:00:00.000Z",
            updatedAt: "2026-05-14T00:01:00.000Z",
            messages: [],
          },
        ],
      }),
    }));
    const fixture = createUseChatListFixture({
      getSessionsApi,
      getSessionDetailApi: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          exists: true,
          sessionId: "backend-2",
          sessions: [{ sessionId: "backend-2", messages: [] }],
        }),
      })),
    });

    expect(fixture.refs.loadingSessions.value).toBe(false);
    await fixture.api.fetchSessions("", { silent: true, preserveCurrentMessages: true });
    expect(getSessionsApi).toHaveBeenCalledTimes(1);
    expect(fixture.refs.loadingSessions.value).toBe(false);
  });

  it("fetchSessions can force the unchanged active session to reload and rerender messages", async () => {
    const existingMessages = [{ role: RoleEnum.USER, content: "stale local" }];
    const fixture = createUseChatListFixture({
      getSessionsApi: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          sessions: [
            {
              sessionId: "backend-refresh",
              caller: RoleEnum.USER,
              createdAt: "2026-05-14T00:00:00.000Z",
              updatedAt: "2026-05-14T00:03:00.000Z",
              messages: [{ role: RoleEnum.USER, content: "summary" }],
            },
          ],
        }),
      })),
      getSessionDetailApi: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          exists: true,
          sessionId: "backend-refresh",
          sessions: [
            {
              sessionId: "backend-refresh",
              currentTaskId: "",
              createdAt: "2026-05-14T00:00:00.000Z",
              updatedAt: "2026-05-14T00:03:00.000Z",
              messages: [
                { role: RoleEnum.USER, content: "fresh server" },
                { role: RoleEnum.ASSISTANT, content: "fresh answer" },
              ],
            },
          ],
        }),
      })),
    });
    const { api, refs, mocks } = fixture;
    refs.sessions.value = [{
      id: "backend-refresh",
      backendSessionId: "backend-refresh",
      title: "loaded",
      isLocal: false,
      loaded: true,
      messages: existingMessages,
      rawMessages: [],
      sessionDocs: [{ sessionId: "backend-refresh", messages: existingMessages }],
      connectorPanelState: { selectedConnectors: {} },
    }];
    refs.activeSessionId.value = "backend-refresh";

    await api.fetchSessions("", {
      forceCurrentSessionRerender: true,
      preserveCurrentMessages: false,
    });

    expect(mocks.getSessionDetailApi).toHaveBeenCalledTimes(1);
    expect(refs.activeSessionId.value).toBe("backend-refresh");
    expect(refs.sessions.value[0].messages).not.toBe(existingMessages);
    expect(refs.sessions.value[0].messages.map((message) => message.content)).toEqual([
      "fresh server",
      "fresh answer",
    ]);
  });

  it("fetchSessionDetail can reuse a just-loaded detail snapshot for initialization replay", async () => {
    const getSessionDetailApi = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        exists: true,
        sessionId: "backend-cache",
        sessions: [{ sessionId: "backend-cache", messages: [] }],
      }),
    }));
    const { api } = createUseChatListFixture({ getSessionDetailApi });

    const first = await api.fetchSessionDetail("backend-cache");
    const second = await api.fetchSessionDetail("backend-cache", { reuseRecentlyLoaded: true });

    expect(first).toBe(second);
    expect(getSessionDetailApi).toHaveBeenCalledTimes(1);
  });

  it("session detail arbiter waits for an in-flight request for the same session", async () => {
    let resolveResponse;
    const getSessionDetailApi = vi.fn(
      () => new Promise((resolve) => {
        resolveResponse = () => resolve({
          ok: true,
          json: async () => ({
            ok: true,
            exists: true,
            sessionId: "backend-pending",
            sessions: [{ sessionId: "backend-pending", messages: [] }],
          }),
        });
      }),
    );
    const { api } = createUseChatListFixture({ getSessionDetailApi });

    const firstPromise = api.fetchSessionDetail("backend-pending", { source: "selectSession" });
    const secondPromise = api.fetchSessionDetail("backend-pending", { source: "reconnectHydration" });
    resolveResponse();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toBe(second);
    expect(getSessionDetailApi).toHaveBeenCalledTimes(1);
  });

  it("session detail arbiter reuses the active loaded session snapshot for hydration intent", async () => {
    const getSessionDetailApi = vi.fn();
    const { api, refs } = createUseChatListFixture({ getSessionDetailApi });
    refs.sessions.value = [{
      id: "s-loaded",
      backendSessionId: "s-loaded",
      title: "loaded",
      isLocal: false,
      loaded: true,
      messages: [{ role: RoleEnum.USER, content: "hi" }],
      rawMessages: [],
      sessionDocs: [{ sessionId: "s-loaded", messages: [{ role: RoleEnum.USER, content: "hi" }] }],
      connectorPanelState: { selectedConnectors: {} },
    }];
    refs.activeSessionId.value = "s-loaded";

    const detail = await api.fetchSessionDetail("s-loaded", {
      source: "reconnectHydration",
      allowLoadedSnapshot: true,
    });

    expect(detail.sessionId).toBe("s-loaded");
    expect(detail.sessions).toBe(refs.sessions.value[0].sessionDocs);
    expect(getSessionDetailApi).not.toHaveBeenCalled();
  });

  it("applySessionDetail with preserveCurrentMessages keeps current rendered messages", () => {
    const { api, refs } = createUseChatListFixture();
    const originalMessages = [{ role: RoleEnum.ASSISTANT, content: "pending local" }];
    const session = {
      id: "local-3",
      backendSessionId: "backend-3",
      title: "session",
      isLocal: true,
      loaded: false,
      messages: originalMessages,
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: 1,
      lastMessage: originalMessages[0],
    };
    refs.sessions.value.push(session);
    refs.activeSessionId.value = "local-3";

    api.applySessionDetail(
      {
        sessionId: "backend-3",
        sessions: [
          {
            sessionId: "backend-3",
            currentTaskId: "",
            createdAt: "2026-05-14T00:00:00.000Z",
            updatedAt: "2026-05-14T00:02:00.000Z",
            messages: [{ role: RoleEnum.ASSISTANT, content: "server snapshot" }],
          },
        ],
      },
      { preserveCurrentMessages: true },
    );

    expect(session.id).toBe("backend-3");
    expect(refs.activeSessionId.value).toBe("backend-3");
    expect(session.messages).toBe(originalMessages);
    expect(session.messages[0].content).toBe("pending local");
  });

  it("applySessionDetail with preserveCurrentMessages replaces matching local user instead of duplicating it", () => {
    const { api, refs } = createUseChatListFixture();
    const localUserMessage = {
      role: RoleEnum.USER,
      content: "edited question",
      pending: true,
    };
    const localAssistantMessage = {
      role: RoleEnum.ASSISTANT,
      content: "pending answer",
      dialogProcessId: "dp-edited",
      pending: true,
    };
    const session = {
      id: "local-edited",
      backendSessionId: "backend-edited",
      title: "session",
      isLocal: true,
      loaded: true,
      messages: [localUserMessage, localAssistantMessage],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: 2,
      lastMessage: localAssistantMessage,
    };
    refs.sessions.value.push(session);
    refs.activeSessionId.value = "local-edited";

    api.applySessionDetail(
      {
        sessionId: "backend-edited",
        sessions: [
          {
            sessionId: "backend-edited",
            currentTaskId: "",
            createdAt: "2026-05-14T00:00:00.000Z",
            updatedAt: "2026-05-14T00:02:00.000Z",
            messages: [
              {
                role: RoleEnum.USER,
                content: "edited question",
                dialogProcessId: "dp-edited",
              },
              {
                role: RoleEnum.ASSISTANT,
                content: "final answer",
                dialogProcessId: "dp-edited",
              },
            ],
          },
        ],
      },
      { preserveCurrentMessages: true },
    );

    const userMessages = session.messages.filter((message) => message.role === RoleEnum.USER);
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toBe(localUserMessage);
    expect(userMessages[0].dialogProcessId).toBe("dp-edited");
    expect(userMessages[0].pending).toBe(false);
    expect(session.messages).toHaveLength(2);
    expect(session.messages[1]).toBe(localAssistantMessage);
    expect(session.messages[1].content).toBe("final answer");
    expect(session.messageCount).toBe(2);
  });

  it("applySessionDetail reuses a turn placeholder for the completed assistant reply", () => {
    const { api, refs } = createUseChatListFixture();
    const turnScopeId = "client-turn:completed-placeholder";
    const userMessage = { role: RoleEnum.USER, content: "question", turnScopeId };
    const placeholder = {
      role: RoleEnum.ASSISTANT,
      content: "",
      turnScopeId,
      turnPlaceholder: true,
      placeholder: true,
      pending: true,
    };
    const session = {
      id: "local-completed-placeholder",
      backendSessionId: "backend-completed-placeholder",
      title: "session",
      isLocal: true,
      loaded: true,
      messages: [userMessage, placeholder],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: 2,
      lastMessage: placeholder,
    };
    refs.sessions.value.push(session);
    refs.activeSessionId.value = session.id;

    api.applySessionDetail({
      sessionId: session.backendSessionId,
      sessions: [{
        sessionId: session.backendSessionId,
        messages: [
          { role: RoleEnum.USER, content: "question", turnScopeId, dialogProcessId: "dp-completed" },
          { role: RoleEnum.ASSISTANT, content: "final answer", turnScopeId, dialogProcessId: "dp-completed" },
        ],
      }],
    }, { preserveCurrentMessages: true });

    const assistantMessages = session.messages.filter((message) => message.role === RoleEnum.ASSISTANT);
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toBe(placeholder);
    expect(assistantMessages[0]).toEqual(expect.objectContaining({
      content: "final answer",
      dialogProcessId: "dp-completed",
      pending: false,
    }));
  });

  it("applySessionDetail preserves one inline editing user message when stop refresh returns original content", () => {
    const { api, refs } = createUseChatListFixture();
    const editingUserMessage = {
      role: RoleEnum.USER,
      content: "draft edited question",
      __monotonicEditing: true,
    };
    const stoppedAssistantMessage = {
      role: RoleEnum.ASSISTANT,
      content: "partial answer",
      dialogProcessId: "dp-editing-stop",
      pending: false,
      statusLabel: "chat.stopped",
    };
    const session = {
      id: "local-editing-stop",
      backendSessionId: "backend-editing-stop",
      title: "session",
      isLocal: true,
      loaded: true,
      messages: [editingUserMessage, stoppedAssistantMessage],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: 2,
      lastMessage: stoppedAssistantMessage,
    };
    refs.sessions.value.push(session);
    refs.activeSessionId.value = "local-editing-stop";

    api.applySessionDetail(
      {
        sessionId: "backend-editing-stop",
        sessions: [
          {
            sessionId: "backend-editing-stop",
            currentTaskId: "",
            createdAt: "2026-05-14T00:00:00.000Z",
            updatedAt: "2026-05-14T00:02:00.000Z",
            messages: [
              {
                role: RoleEnum.USER,
                content: "original question",
                dialogProcessId: "dp-editing-stop",
              },
              {
                role: RoleEnum.ASSISTANT,
                content: "stopped answer",
                dialogProcessId: "dp-editing-stop",
              },
            ],
          },
        ],
      },
      { preserveCurrentMessages: true },
    );

    const userMessages = session.messages.filter((message) => message.role === RoleEnum.USER);
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toBe(editingUserMessage);
    expect(userMessages[0].content).toBe("draft edited question");
    expect(userMessages[0].__monotonicEditing).toBe(true);
    expect(userMessages[0].dialogProcessId).toBe("dp-editing-stop");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[1]).toBe(stoppedAssistantMessage);
    expect(session.messages[1].content).toBe("stopped answer");
  });

  it("applySessionDetail keeps active messages when backend detail is briefly empty", () => {
    const { api, refs } = createUseChatListFixture();
    const currentMessages = [
      { role: RoleEnum.USER, content: "hello" },
      { role: RoleEnum.ASSISTANT, content: "final answer", dialogProcessId: "dp-1" },
    ];
    const session = {
      id: "local-empty-detail",
      backendSessionId: "backend-empty-detail",
      title: "session",
      isLocal: true,
      loaded: false,
      messages: currentMessages,
      rawMessages: currentMessages,
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: currentMessages.length,
      lastMessage: currentMessages[currentMessages.length - 1],
    };
    refs.sessions.value.push(session);
    refs.activeSessionId.value = "local-empty-detail";

    api.applySessionDetail({
      sessionId: "backend-empty-detail",
      sessions: [
        {
          sessionId: "backend-empty-detail",
          currentTaskId: "",
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:02:00.000Z",
          messages: [],
        },
      ],
    });

    expect(session.id).toBe("backend-empty-detail");
    expect(refs.activeSessionId.value).toBe("backend-empty-detail");
    expect(session.messages).toBe(currentMessages);
    expect(session.messageCount).toBe(2);
    expect(session.lastMessage).toBe(currentMessages[1]);
  });

  it("applySessionDetail can skip scrolling when session detail is restored on reload", () => {
    const { api, refs, mocks } = createUseChatListFixture();
    const session = {
      id: "reload-local",
      backendSessionId: "reload-backend",
      title: "old title",
      isLocal: true,
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: 0,
      lastMessage: null,
    };
    refs.sessions.value.push(session);
    refs.activeSessionId.value = "reload-local";

    api.applySessionDetail(
      {
        sessionId: "reload-backend",
        sessions: [
          {
            sessionId: "reload-backend",
            currentTaskId: "",
            createdAt: "2026-05-14T00:00:00.000Z",
            updatedAt: "2026-05-14T00:02:00.000Z",
            messages: [
              { role: RoleEnum.USER, content: "restored question" },
              { role: RoleEnum.ASSISTANT, content: "restored answer" },
            ],
          },
        ],
      },
      { scrollToBottom: false },
    );

    expect(refs.activeSessionId.value).toBe("reload-backend");
    expect(session.loaded).toBe(true);
    expect(session.messages).toHaveLength(2);
    expect(session.title).toBe("restored question");
    expect(mocks.scrollBottom).not.toHaveBeenCalled();
  });

  it("selectSession allows switching while another session is sending", async () => {
    const { api, refs, mocks } = createUseChatListFixture();
    refs.sessions.value = [
      {
        id: "s-1",
        backendSessionId: "s-1",
        title: "A",
        isLocal: true,
        loaded: true,
        messages: [],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectors: {} },
      },
      {
        id: "s-2",
        backendSessionId: "s-2",
        title: "B",
        isLocal: true,
        loaded: true,
        messages: [],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectors: {} },
      },
    ];
    refs.activeSessionId.value = "s-1";
    refs.sending.value = true;

    await api.selectSession("s-2", { silent: false });
    expect(refs.activeSessionId.value).toBe("s-2");
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
