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
    scrollBottom: vi.fn(),
    refreshSessionConnectorsAsync: vi.fn(),
    clearUploads: vi.fn(),
    notify: vi.fn(),
  });

  return {
    api,
    refs: {
      sessions,
      activeSessionId,
      loadingSessions,
      loadingSessionDetail,
    },
    mocks: { getSessionsApi, getSessionDetailApi },
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
});
