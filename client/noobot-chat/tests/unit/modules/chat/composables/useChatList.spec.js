/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useChatList } from "../../../../../src/modules/chat/composables/useChatList.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

vi.mock("../../../../../src/shared/i18n/useLocale", () => ({
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
  const refreshSessionConnectorsAsync = vi.fn();

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
    createConnectorPanelState: () => ({ selectedConnectorIds: [], connectors: [] }),
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
    refreshSessionConnectorsAsync,
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
    mocks: {
      getSessionsApi,
      getSessionDetailApi,
      notify,
      scrollBottom,
      refreshSessionConnectorsAsync,
    },
  };
}

describe("useChatList", () => {
  it("keeps a new Session local across navigation until the backend identity is provisioned", async () => {
    const { api, refs, mocks } = createUseChatListFixture();
    const persisted = {
      sessionId: "persisted-1",
      title: "Persisted",
      isLocal: false,
      loaded: true,
      messages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectorIds: [], connectors: [] },
    };
    refs.sessions.value = [persisted];
    refs.activeSessionId.value = persisted.sessionId;

    api.newSession();
    const local = refs.sessions.value[0];
    expect(local).toMatchObject({
      sessionId: "local-generated",
      isLocal: true,
      loaded: true,
    });
    expect(mocks.refreshSessionConnectorsAsync).toHaveBeenCalledWith("local-generated");

    await api.selectSession("persisted-1");
    await api.selectSession("local-generated");

    expect(refs.activeSessionId.value).toBe("local-generated");
    expect(mocks.getSessionDetailApi).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("fetchSessions preserves active optimistic detail under its preallocated identity", async () => {
    const fixture = createUseChatListFixture();
    const { api, refs, mocks } = fixture;
    const existingMessages = [{ role: RoleEnum.USER, content: "local" }];
    const existingSession = {
      sessionId: "backend-1",
      title: "old",
      isLocal: true,
      loaded: true,
      messages: existingMessages,
      rawMessages: existingMessages,
      sessionDocs: [{ sessionId: "backend-1", messages: [] }],
      connectorPanelState: { selectedConnectorIds: [], connectors: [] },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: 1,
      lastMessage: existingMessages[0],
    };

    refs.sessions.value.push(existingSession);
    refs.activeSessionId.value = "backend-1";
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

    await api.fetchSessions("backend-1", {
      silent: true,
    });

    expect(refs.sessions.value).toBe(sessionsArrayRef);
    expect(refs.sessions.value[0]).toBe(existingSessionRef);
    expect(refs.sessions.value[0].messages).toBe(existingMessagesRef);
    expect(refs.sessions.value[0].messages).toEqual(existingMessages);
    expect(refs.activeSessionId.value).toBe("backend-1");
    expect(mocks.getSessionDetailApi).not.toHaveBeenCalled();
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
    await fixture.api.fetchSessions("", { silent: true });
    expect(getSessionsApi).toHaveBeenCalledTimes(1);
    expect(fixture.refs.loadingSessions.value).toBe(false);
  });

  it("loads an explicitly requested Session from detail when the list projection is behind", async () => {
    const fixture = createUseChatListFixture({
      getSessionsApi: vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, sessions: [] }),
      })),
      getSessionDetailApi: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          exists: true,
          sessionId: "session-from-route",
          sessions: [
            {
              sessionId: "session-from-route",
              caller: RoleEnum.USER,
              messages: [
                {
                  id: "route-message",
                  messageId: "route-message",
                  role: RoleEnum.USER,
                  content: "authority",
                  turnScopeId: "route-turn",
                  dialogProcessId: "route-dialog",
                },
              ],
            },
          ],
        }),
      })),
    });

    await expect(
      fixture.api.fetchSessions("session-from-route", {
        forceCurrentSessionRerender: true,
      }),
    ).resolves.toBe(true);

    expect(fixture.mocks.getSessionDetailApi).toHaveBeenCalledTimes(1);
    expect(fixture.refs.activeSessionId.value).toBe("session-from-route");
    expect(fixture.refs.sessions.value[0]).toMatchObject({
      sessionId: "session-from-route",
      isLocal: false,
      loaded: true,
    });
    expect(fixture.refs.sessions.value[0].messages).toEqual([
      expect.objectContaining({ role: RoleEnum.USER, content: "authority" }),
    ]);
  });

  it("keeps the authoritative list when an explicit Session route does not exist", async () => {
    const getSessionDetailApi = vi.fn(async ({ sessionId }) => ({
      ok: true,
      json: async () =>
        sessionId === "missing-session"
          ? { ok: true, exists: false, sessionId }
          : {
              ok: true,
              exists: true,
              sessionId,
              sessions: [{ sessionId, caller: RoleEnum.USER, messages: [] }],
            },
    }));
    const fixture = createUseChatListFixture({
      getSessionsApi: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          sessions: [
            {
              sessionId: "persisted-session",
              caller: RoleEnum.USER,
              updatedAt: "2026-08-05T00:00:00.000Z",
            },
          ],
        }),
      })),
      getSessionDetailApi,
    });

    await expect(
      fixture.api.fetchSessions("missing-session", {
        forceCurrentSessionRerender: true,
      }),
    ).resolves.toBe(true);

    expect(fixture.refs.sessions.value.map((session) => session.sessionId)).toEqual([
      "persisted-session",
    ]);
    expect(fixture.refs.activeSessionId.value).toBe("persisted-session");
    expect(fixture.mocks.notify).not.toHaveBeenCalled();
    expect(getSessionDetailApi).toHaveBeenCalledWith(
      { userId: "u-1", sessionId: "missing-session" },
      { fetcher: null },
    );
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
                {
                  id: "refresh-user",
                  messageId: "refresh-user",
                  role: RoleEnum.USER,
                  content: "fresh server",
                },
                {
                  id: "refresh-assistant",
                  messageId: "refresh-assistant",
                  role: RoleEnum.ASSISTANT,
                  content: "fresh answer",
                },
              ],
            },
          ],
        }),
      })),
    });
    const { api, refs, mocks } = fixture;
    refs.sessions.value = [
      {
        id: "backend-refresh",
        sessionId: "backend-refresh",
        title: "loaded",
        isLocal: false,
        loaded: true,
        messages: existingMessages,
        rawMessages: [],
        sessionDocs: [{ sessionId: "backend-refresh", messages: existingMessages }],
        connectorPanelState: { selectedConnectorIds: [], connectors: [] },
      },
    ];
    refs.activeSessionId.value = "backend-refresh";

    await api.fetchSessions("", {
      forceCurrentSessionRerender: true,
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
      () =>
        new Promise((resolve) => {
          resolveResponse = () =>
            resolve({
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
    const secondPromise = api.fetchSessionDetail("backend-pending", {
      source: "reconnectHydration",
    });
    resolveResponse();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toBe(second);
    expect(getSessionDetailApi).toHaveBeenCalledTimes(1);
  });

  it("session detail arbiter reuses the active loaded session snapshot for hydration intent", async () => {
    const getSessionDetailApi = vi.fn();
    const { api, refs } = createUseChatListFixture({ getSessionDetailApi });
    refs.sessions.value = [
      {
        id: "s-loaded",
        sessionId: "s-loaded",
        title: "loaded",
        isLocal: false,
        loaded: true,
        messages: [{ role: RoleEnum.USER, content: "hi" }],
        rawMessages: [],
        sessionDocs: [
          { sessionId: "s-loaded", messages: [{ role: RoleEnum.USER, content: "hi" }] },
        ],
        connectorPanelState: { selectedConnectorIds: [], connectors: [] },
      },
    ];
    refs.activeSessionId.value = "s-loaded";

    const detail = await api.fetchSessionDetail("s-loaded", {
      source: "reconnectHydration",
      allowLoadedSnapshot: true,
    });

    expect(detail.sessionId).toBe("s-loaded");
    expect(detail.sessions).toBe(refs.sessions.value[0].sessionDocs);
    expect(getSessionDetailApi).not.toHaveBeenCalled();
  });

  it("applySessionDetail can skip scrolling when session detail is restored on reload", () => {
    const { api, refs, mocks } = createUseChatListFixture();
    const session = {
      sessionId: "reload-backend",
      title: "old title",
      isLocal: true,
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectorIds: [], connectors: [] },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: 0,
      lastMessage: null,
    };
    refs.sessions.value.push(session);
    refs.activeSessionId.value = "reload-backend";

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
              {
                id: "restored-user",
                messageId: "restored-user",
                role: RoleEnum.USER,
                content: "restored question",
              },
              {
                id: "restored-assistant",
                messageId: "restored-assistant",
                role: RoleEnum.ASSISTANT,
                content: "restored answer",
              },
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
        sessionId: "s-1",
        title: "A",
        isLocal: true,
        loaded: true,
        messages: [],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectorIds: [], connectors: [] },
      },
      {
        id: "s-2",
        sessionId: "s-2",
        title: "B",
        isLocal: true,
        loaded: true,
        messages: [],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectorIds: [], connectors: [] },
      },
    ];
    refs.activeSessionId.value = "s-1";
    await api.selectSession("s-2", { silent: false });
    expect(refs.activeSessionId.value).toBe("s-2");
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
