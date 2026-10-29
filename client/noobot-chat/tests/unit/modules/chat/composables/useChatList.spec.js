/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useChatList } from "../../../../../src/modules/chat/composables/useChatList.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { createTurnRuntimeRegistryState } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { createTurnRuntimeStoreActions } from "../../../../../src/modules/chat/stores/chatStoreTurnRuntime.js";
import { createLocalSessionItem } from "../../../../../src/modules/session/model/list/sessionRecords.js";
import { rejectUnexpectedRequest } from "../../../helpers/jsonResponse.js";
import {
  availableDetailDocument,
  availableDetailEntry,
  availableSummaryEntry,
  detailResponse,
  missingDetailDocument,
  sessionsSummaryResponse,
} from "../../../helpers/sessionDetailFixture.js";

vi.mock("../../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key) => key,
  }),
}));

function listResponse(entries) {
  return sessionsSummaryResponse({
    userId: "u-1",
    updatedAt: "2026-08-05T00:00:00.000Z",
    sessions: entries.map(({ sessionId, updatedAt }) =>
      availableSummaryEntry({
        sessionId,
        title: sessionId,
        aggregateVersion: 1,
        messageCount: 0,
        updatedAt,
      }),
    ),
  });
}

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
  const refreshSessionConnectorsAsync = vi.fn();
  const authFetch = vi.fn(rejectUnexpectedRequest);

  const getSessionsApi = overrides.getSessionsApi || vi.fn();
  const getSessionDetailApi = overrides.getSessionDetailApi || vi.fn();

  const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
  const chatStore = createTurnRuntimeStoreActions(turnRuntimeRegistry, {
    onTurnCommitted: vi.fn(() => null),
    onTurnEvaluated: vi.fn(),
  });
  const api = useChatList({
    turnRuntimeRegistry,
    chatStore,
    userId,
    connected,
    ensureConnected,
    authFetch,
    sessions,
    activeSessionId,
    loadingSessions,
    loadingSessionDetail,
    sending,
    createConnectorPanelState: () => ({ selectedConnectorIds: [], connectors: [] }),
    generateSessionId: () => "local-generated",
    applyCompletedToolLogsToMessages: vi.fn(),
    getSessionsApi,
    getSessionDetailApi,
    deleteSessionApi: vi.fn(),
    renameSessionApi: vi.fn(),
    onSessionDetailApplied: vi.fn(),
    makeViewMessage: (message) => ({ ...message }),
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
      authFetch,
      getSessionsApi,
      getSessionDetailApi,
      notify,
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
      sessionDocs: [
        availableDetailEntry({
          sessionId: "persisted-1",
          title: "Persisted",
          aggregateVersion: 1,
          messages: [],
          turnTimings: [],
        }),
      ],
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
      ...createLocalSessionItem({
        id: "backend-1",
        title: "old",
        createConnectorPanelState: () => ({ selectedConnectorIds: [], connectors: [] }),
      }),
      messages: existingMessages,
    };

    refs.sessions.value.push(existingSession);
    refs.activeSessionId.value = "backend-1";
    const sessionsArrayRef = refs.sessions.value;
    const existingSessionRef = refs.sessions.value[0];
    const existingMessagesRef = refs.sessions.value[0].messages;

    mocks.getSessionsApi.mockResolvedValue(
      listResponse([{ sessionId: "backend-1", updatedAt: "2026-05-14T00:01:00.000Z" }]),
    );
    mocks.getSessionDetailApi.mockResolvedValue(
      detailResponse(
        availableDetailDocument({
          sessionId: "backend-1",
          title: "backend-1",
          aggregateVersion: 1,
          messages: [],
          turnTimings: [],
        }),
      ),
    );

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
    const getSessionsApi = vi.fn(async () =>
      listResponse([{ sessionId: "backend-2", updatedAt: "2026-05-14T00:01:00.000Z" }]),
    );
    const fixture = createUseChatListFixture({
      getSessionsApi,
      getSessionDetailApi: vi.fn(async () =>
        detailResponse(
          availableDetailDocument({
            sessionId: "backend-2",
            title: "backend-2",
            aggregateVersion: 1,
            messages: [],
            turnTimings: [],
          }),
        ),
      ),
    });

    expect(fixture.refs.loadingSessions.value).toBe(false);
    await fixture.api.fetchSessions("", { silent: true });
    expect(getSessionsApi).toHaveBeenCalledTimes(1);
    expect(fixture.refs.loadingSessions.value).toBe(false);
  });

  it("loads an explicitly requested Session from detail when the list projection is behind", async () => {
    const fixture = createUseChatListFixture({
      getSessionsApi: vi.fn(async () => listResponse([])),
      getSessionDetailApi: vi.fn(async () =>
        detailResponse(
          availableDetailDocument({
            sessionId: "session-from-route",
            title: "Route session",
            aggregateVersion: 1,
            turnTimings: [],
            messages: [
              {
                messageUid: "route-message",
                userMessageId: "route-message",
                role: RoleEnum.USER,
                content: "authority",
                turnScopeId: "route-turn",
                dialogProcessId: "route-dialog",
              },
            ],
          }),
        ),
      ),
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
    const getSessionDetailApi = vi.fn(async ({ sessionId }) =>
      detailResponse(
        sessionId === "missing-session"
          ? missingDetailDocument({ sessionId })
          : availableDetailDocument({
              sessionId,
              title: sessionId,
              aggregateVersion: 1,
              messages: [],
              turnTimings: [],
            }),
      ),
    );
    const fixture = createUseChatListFixture({
      getSessionsApi: vi.fn(async () =>
        listResponse([{ sessionId: "persisted-session", updatedAt: "2026-08-05T00:00:00.000Z" }]),
      ),
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
      { fetcher: fixture.mocks.authFetch },
    );
  });

  it("fetchSessions can force the unchanged active session to reload and rerender messages", async () => {
    const existingMessages = [{ role: RoleEnum.USER, content: "stale local" }];
    const fixture = createUseChatListFixture({
      getSessionsApi: vi.fn(async () =>
        listResponse([{ sessionId: "backend-refresh", updatedAt: "2026-05-14T00:03:00.000Z" }]),
      ),
      getSessionDetailApi: vi.fn(async () =>
        detailResponse(
          availableDetailDocument({
            sessionId: "backend-refresh",
            title: "backend-refresh",
            aggregateVersion: 1,
            turnTimings: [],
            messages: [
              {
                messageUid: "refresh-user",
                userMessageId: "refresh-user",
                role: RoleEnum.USER,
                content: "fresh server",
              },
              {
                presentationMessageId: "refresh-assistant",
                role: RoleEnum.ASSISTANT,
                content: "fresh answer",
              },
            ],
          }),
        ),
      ),
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
        sessionDocs: [
          availableDetailEntry({
            sessionId: "backend-refresh",
            title: "loaded",
            aggregateVersion: 0,
            messages: existingMessages,
            turnTimings: [],
          }),
        ],
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
    const getSessionDetailApi = vi.fn(async () =>
      detailResponse(
        availableDetailDocument({
          sessionId: "backend-cache",
          title: "backend-cache",
          aggregateVersion: 1,
          messages: [],
          turnTimings: [],
        }),
      ),
    );
    const { api } = createUseChatListFixture({ getSessionDetailApi });

    const first = await api.fetchSessionDetail("backend-cache", { source: "selectSession" });
    const second = await api.fetchSessionDetail("backend-cache", {
      source: "reconnectProtocolReconcile",
      reuseRecentlyLoaded: true,
    });

    expect(first).toBe(second);
    expect(getSessionDetailApi).toHaveBeenCalledTimes(1);
  });

  it("session detail arbiter waits for an in-flight request for the same session", async () => {
    let resolveResponse;
    const getSessionDetailApi = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveResponse = () =>
            resolve(
              detailResponse(
                availableDetailDocument({
                  sessionId: "backend-pending",
                  title: "backend-pending",
                  aggregateVersion: 1,
                  messages: [],
                  turnTimings: [],
                }),
              ),
            );
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
        sessionDocs: [
          availableDetailEntry({
            sessionId: "s-loaded",
            title: "loaded",
            aggregateVersion: 1,
            messages: [{ role: RoleEnum.USER, content: "hi" }],
            turnTimings: [],
          }),
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

  it("applySessionDetail restores session detail on reload", () => {
    const { api, refs } = createUseChatListFixture();
    const session = {
      sessionId: "reload-backend",
      title: "old title",
      aggregateVersion: 0,
      isLocal: true,
      loaded: false,
      messages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectorIds: [], connectors: [] },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      messageCount: 0,
      lastMessage: null,
    };
    refs.sessions.value.push(session);
    refs.activeSessionId.value = "reload-backend";

    api.applySessionDetail(
      availableDetailDocument({
        sessionId: "reload-backend",
        title: "Authority title",
        aggregateVersion: 1,
        turnTimings: [],
        messages: [
          {
            messageUid: "restored-user",
            userMessageId: "restored-user",
            role: RoleEnum.USER,
            content: "restored question",
          },
          {
            presentationMessageId: "restored-assistant",
            role: RoleEnum.ASSISTANT,
            content: "restored answer",
          },
        ],
      }),
    );

    expect(refs.activeSessionId.value).toBe("reload-backend");
    expect(session.loaded).toBe(true);
    expect(session.messages).toHaveLength(2);
    expect(session.title).toBe("Authority title");
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
