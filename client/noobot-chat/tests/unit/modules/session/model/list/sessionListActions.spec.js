/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";

import { createSessionListActions } from "../../../../../../src/modules/session/model/list/sessionListActions.js";
import {
  applyTurnRuntimeEvent,
  createTurnRuntimeRegistryState,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { API_REQUEST_ERROR_CODE, ApiRequestError } from "@noobot/shared/request-error";
import { SESSION_RUN_EVENT } from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { jsonResponse } from "../../../../helpers/jsonResponse.js";
import { ROOT_PARENT_SESSION_ID } from "@noobot/agent-transport-protocol";

function ref(value) {
  return { value };
}

function createHarness(overrides = {}) {
  const sessions = ref([
    {
      sessionId: "s1",
      title: "Old title",
      caller: "user",
      messages: [{ role: "user", content: "hello" }],
    },
  ]);
  const notify = vi.fn();
  const renameSessionApi = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
  const getSessionsApi = vi.fn().mockResolvedValue(
    jsonResponse({
      ok: true,
      sessions: [
        {
          sessionId: "s1",
          parentSessionId: ROOT_PARENT_SESSION_ID,
          title: "New title",
          caller: "user",
          activeTurnScopeId: "",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  const fetchSessionDetail = vi.fn().mockResolvedValue(null);
  const actions = createSessionListActions({
    sessions,
    activeSessionId: ref("s1"),
    loadingSessions: ref(false),
    loadingSessionDetail: ref(false),
    turnRuntimeRegistry: ref(createTurnRuntimeRegistryState()),
    userId: ref("u1"),
    authFetch: vi.fn(),
    ensureConnected: vi.fn(() => true),
    getSessionsApi,
    deleteSessionApi: vi.fn(),
    renameSessionApi,
    createConnectorPanelState: vi.fn(() => ({})),
    sessionTitleFromMessages: vi.fn(() => "message title"),
    fetchSessionDetail,
    applySessionDetail: vi.fn(),
    createLocalSession: vi.fn(),
    refreshSessionConnectorsAsync: vi.fn(),
    onSessionDetailApplied: vi.fn(),
    translate: (key) => key,
    notify,
    ...overrides,
  });
  return { actions, sessions, notify, renameSessionApi, getSessionsApi, fetchSessionDetail };
}

describe("createSessionListActions.fetchSessions identity reconciliation", () => {
  it("reconciles an optimistic Session by its preallocated identity", async () => {
    const turnScopeId = "client-turn:refresh-1";
    const sessions = ref([
      {
        sessionId: "session-1",
        isLocal: true,
        caller: "user",
        messages: [{ role: "assistant", turnScopeId, pending: true }],
      },
    ]);
    const activeSessionId = ref("session-1");
    const registry = createTurnRuntimeRegistryState();
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "session-1",
      turnScopeId,
      dialogProcessId: "dp-1",
      source: "test",
    });
    const turnRuntimeRegistry = ref(registry);
    const getSessionsApi = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        sessions: [
          {
            sessionId: "session-1",
            parentSessionId: ROOT_PARENT_SESSION_ID,
            caller: "user",
            activeTurnScopeId: "",
            updatedAt: "2026-01-01T00:00:00.000Z",
            turnLifecycleSnapshot: {
              activeTurn: null,
              recentTerminalTurns: [{ turnScopeId, state: "completed", sequence: 2 }],
            },
          },
        ],
      }),
    );
    const { actions } = createHarness({
      sessions,
      activeSessionId,
      turnRuntimeRegistry,
      getSessionsApi,
    });

    await expect(actions.fetchSessions("session-1", { silent: true })).resolves.toBe(true);

    expect(activeSessionId.value).toBe("session-1");
    expect(turnRuntimeRegistry.value.sessions["session-1"]?.turns?.[turnScopeId]).toMatchObject({
      sessionId: "session-1",
      turnScopeId,
    });
  });
});

describe("createSessionListActions unavailable sessions", () => {
  it("does not fetch details for an unavailable session", async () => {
    const sessions = ref([
      {
        sessionId: "legacy",
        title: "Legacy session",
        isUnavailable: true,
        availability: "unavailable",
        unavailableReason: { code: "INVALID_TRANSFER_ENVELOPE", message: "legacy protocol" },
      },
    ]);
    const activeSessionId = ref("");
    const { actions, fetchSessionDetail, notify } = createHarness({ sessions, activeSessionId });

    await actions.selectSession("legacy");

    expect(activeSessionId.value).toBe("");
    expect(fetchSessionDetail).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ type: "warning", message: "legacy protocol" });
  });
});

describe("createSessionListActions.selectSession error classification", () => {
  function remoteSessions() {
    return ref([
      { sessionId: "s1", parentSessionId: ROOT_PARENT_SESSION_ID, caller: "user", messages: [] },
      { sessionId: "s2", parentSessionId: ROOT_PARENT_SESSION_ID, caller: "user", messages: [] },
    ]);
  }

  it("notifies request failures without applying a detail", async () => {
    const applySessionDetail = vi.fn();
    const fetchSessionDetail = vi.fn().mockRejectedValue(
      new ApiRequestError("detail unavailable", {
        code: API_REQUEST_ERROR_CODE.HTTP,
        status: 503,
      }),
    );
    const { actions, notify } = createHarness({
      sessions: remoteSessions(),
      fetchSessionDetail,
      applySessionDetail,
    });

    await actions.selectSession("s2");

    expect(notify).toHaveBeenCalledWith({ type: "error", message: "detail unavailable" });
    expect(applySessionDetail).not.toHaveBeenCalled();
  });

  it("propagates contract errors raised while applying the detail", async () => {
    const contractError = new TypeError("requires turnTimings array");
    const { actions, notify } = createHarness({
      sessions: remoteSessions(),
      fetchSessionDetail: vi.fn().mockResolvedValue({ sessionId: "s2" }),
      applySessionDetail: vi.fn(() => {
        throw contractError;
      }),
    });

    await expect(actions.selectSession("s2")).rejects.toBe(contractError);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("createSessionListActions.renameSession", () => {
  it("rejects empty titles without calling backend", async () => {
    const { actions, notify, renameSessionApi } = createHarness();

    await expect(actions.renameSession("s1", "   ")).resolves.toBe(false);

    expect(renameSessionApi).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({
      type: "warning",
      message: "common.sessionTitleRequired",
    });
  });

  it("allows renaming while another turn is sending", async () => {
    const { actions, notify, renameSessionApi } = createHarness({ sending: ref(true) });

    await expect(actions.renameSession("s1", "New title")).resolves.toBe(true);

    expect(renameSessionApi).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith({
      type: "warning",
      message: "common.cannotRenameWhileSending",
    });
  });

  it("rejects unchanged titles without calling backend", async () => {
    const { actions, notify, renameSessionApi } = createHarness();

    await expect(actions.renameSession("s1", " Old title ")).resolves.toBe(false);

    expect(renameSessionApi).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ type: "info", message: "common.sessionTitleUnchanged" });
  });

  it("renames local sessions locally without calling backend", async () => {
    const sessions = ref([{ sessionId: "local-1", title: "Local old", isLocal: true }]);
    const { actions, renameSessionApi } = createHarness({
      sessions,
      activeSessionId: ref("local-1"),
    });

    await expect(actions.renameSession("local-1", " Local new ")).resolves.toBe(true);

    expect(sessions.value[0].title).toBe("Local new");
    expect(renameSessionApi).not.toHaveBeenCalled();
  });

  it("calls backend rename and refreshes session list for persisted sessions", async () => {
    const authFetch = vi.fn();
    const ensureConnected = vi.fn(() => true);
    const { actions, renameSessionApi, getSessionsApi } = createHarness({
      authFetch,
      ensureConnected,
    });

    await expect(actions.renameSession("s1", " New title ")).resolves.toBe(true);

    expect(ensureConnected).toHaveBeenCalled();
    expect(renameSessionApi).toHaveBeenCalledWith(
      { userId: "u1", sessionId: "s1", title: "New title" },
      { fetcher: authFetch },
    );
    expect(getSessionsApi).toHaveBeenCalledWith({ userId: "u1" }, { fetcher: authFetch });
  });
});

describe("createSessionListActions.deleteSession", () => {
  it("does not reload or overwrite the active running Session when deleting another Session", async () => {
    const activeMessage = {
      role: "assistant",
      content: "streaming answer",
      turnScopeId: "turn-active",
      pending: true,
    };
    const activeSession = {
      sessionId: "s-active",
      title: "Active",
      caller: "user",
      loaded: true,
      messages: [activeMessage],
      sessionDocs: [{ sessionId: "s-active", messages: [activeMessage] }],
    };
    const sessions = ref([
      activeSession,
      { sessionId: "s-delete", title: "Delete", caller: "user" },
    ]);
    const activeSessionId = ref("s-active");
    const registry = createTurnRuntimeRegistryState();
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s-active",
      turnScopeId: "turn-active",
      dialogProcessId: "dp-active",
      source: "test",
    });
    const turnRuntimeRegistry = ref(registry);
    const deleteSessionApi = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const getSessionsApi = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        sessions: [
          {
            sessionId: "s-active",
            parentSessionId: ROOT_PARENT_SESSION_ID,
            title: "Active",
            caller: "user",
            activeTurnScopeId: "",
            updatedAt: "2026-01-01T00:01:00.000Z",
          },
        ],
      }),
    );
    const fetchSessionDetail = vi.fn();
    const applySessionDetail = vi.fn();
    const { actions } = createHarness({
      sessions,
      activeSessionId,
      turnRuntimeRegistry,
      deleteSessionApi,
      getSessionsApi,
      fetchSessionDetail,
      applySessionDetail,
    });

    await expect(actions.deleteSession("s-delete")).resolves.toBe(true);

    expect(deleteSessionApi).toHaveBeenCalledWith(
      { userId: "u1", sessionId: "s-delete" },
      expect.any(Object),
    );
    expect(fetchSessionDetail).not.toHaveBeenCalled();
    expect(applySessionDetail).not.toHaveBeenCalled();
    expect(activeSessionId.value).toBe("s-active");
    expect(sessions.value[0]).toBe(activeSession);
    expect(sessions.value[0].messages[0]).toBe(activeMessage);
    expect(turnRuntimeRegistry.value.sessions["s-active"]?.activeTurnScopeId).toBe("turn-active");
  });
});

describe("createSessionListActions requested session detail", () => {
  const remoteSessions = () =>
    ref([
      { sessionId: "s1", parentSessionId: ROOT_PARENT_SESSION_ID, caller: "user", messages: [] },
    ]);

  it("keeps the authoritative list when the requested session does not exist", async () => {
    const sessions = remoteSessions();
    const fetchSessionDetail = vi.fn().mockResolvedValue(null);
    const { actions, notify } = createHarness({ sessions, fetchSessionDetail });

    await expect(actions.fetchSessions("s-missing", { silent: true })).resolves.toBe(true);

    expect(fetchSessionDetail).toHaveBeenCalledWith(
      "s-missing",
      expect.objectContaining({ source: "explicitSessionRoute", requireExists: false }),
    );
    expect(notify).not.toHaveBeenCalled();
    expect(sessions.value.map((session) => session.sessionId)).toEqual(["s1"]);
  });

  it("rejects instead of substituting a branch session when the requested document is absent", async () => {
    const sessions = remoteSessions();
    const fetchSessionDetail = vi.fn().mockResolvedValue({
      sessionId: "s-missing",
      exists: true,
      sessions: [
        { sessionId: "s-child", parentSessionId: "s-missing", caller: "assistant", messages: [] },
      ],
    });
    const { actions, notify } = createHarness({ sessions, fetchSessionDetail });

    await expect(actions.fetchSessions("s-missing", { silent: true })).rejects.toThrow(
      "requested_session_document_missing",
    );

    expect(notify).not.toHaveBeenCalled();
    expect(sessions.value.map((session) => session.sessionId)).toEqual(["s1"]);
  });
});
