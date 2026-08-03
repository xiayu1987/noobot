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
import { SESSION_RUN_EVENT } from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";

function ref(value) {
  return { value };
}

function createHarness(overrides = {}) {
  const sessions = ref([
    { id: "s1", backendSessionId: "backend-s1", title: "Old title", caller: "user", messages: [{ role: "user", content: "hello" }] },
  ]);
  const notify = vi.fn();
  const renameSessionApi = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  const getSessionsApi = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      sessions: [
        { sessionId: "s1", id: "s1", title: "New title", caller: "user", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    }),
  });
  const fetchSessionDetail = vi.fn().mockResolvedValue(null);
  const actions = createSessionListActions({
    sessions,
    activeSessionId: ref("s1"),
    loadingSessions: ref(false),
    loadingSessionDetail: ref(false),
    sending: ref(false),
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
    translate: (key) => key,
    notify,
    ...overrides,
  });
  return { actions, sessions, notify, renameSessionApi, getSessionsApi, fetchSessionDetail };
}

describe("createSessionListActions.fetchSessions identity reconciliation", () => {
  it("atomically promotes the optimistic Session runtime when a summary reveals its canonical identity", async () => {
    const turnScopeId = "client-turn:refresh-1";
    const sessions = ref([{
      id: "local-1",
      isLocal: true,
      caller: "user",
      messages: [{ role: "assistant", turnScopeId, pending: true }],
    }]);
    const activeSessionId = ref("local-1");
    const registry = createTurnRuntimeRegistryState();
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "local-1",
      turnScopeId,
      dialogProcessId: "dp-1",
      source: "test",
    });
    const turnRuntimeRegistry = ref(registry);
    const getSessionsApi = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessions: [{
          sessionId: "backend-1",
          id: "backend-1",
          caller: "user",
          updatedAt: "2026-01-01T00:00:00.000Z",
          turnLifecycleSnapshot: {
            activeTurn: null,
            recentTerminalTurns: [{ turnScopeId, state: "completed", sequence: 2 }],
          },
        }],
      }),
    });
    const { actions } = createHarness({ sessions, activeSessionId, turnRuntimeRegistry, getSessionsApi });

    await expect(actions.fetchSessions("local-1", { silent: true })).resolves.toBe(true);

    expect(activeSessionId.value).toBe("backend-1");
    expect(turnRuntimeRegistry.value.sessionAliases["local-1"]).toBe("backend-1");
    expect(turnRuntimeRegistry.value.sessions["local-1"]).toBeUndefined();
    expect(turnRuntimeRegistry.value.sessions["backend-1"]?.turns?.[turnScopeId]).toMatchObject({
      sessionId: "backend-1",
      turnScopeId,
    });
  });
});

describe("createSessionListActions.renameSession", () => {
  it("rejects empty titles without calling backend", async () => {
    const { actions, notify, renameSessionApi } = createHarness();

    await expect(actions.renameSession("s1", "   ")).resolves.toBe(false);

    expect(renameSessionApi).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ type: "warning", message: "common.sessionTitleRequired" });
  });

  it("allows renaming while another turn is sending", async () => {
    const { actions, notify, renameSessionApi } = createHarness({ sending: ref(true) });

    await expect(actions.renameSession("s1", "New title")).resolves.toBe(true);

    expect(renameSessionApi).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith({ type: "warning", message: "common.cannotRenameWhileSending" });
  });

  it("rejects unchanged titles without calling backend", async () => {
    const { actions, notify, renameSessionApi } = createHarness();

    await expect(actions.renameSession("s1", " Old title ")).resolves.toBe(false);

    expect(renameSessionApi).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ type: "info", message: "common.sessionTitleUnchanged" });
  });

  it("renames local sessions locally without calling backend", async () => {
    const sessions = ref([{ id: "local-1", title: "Local old", isLocal: true }]);
    const { actions, renameSessionApi } = createHarness({ sessions, activeSessionId: ref("local-1") });

    await expect(actions.renameSession("local-1", " Local new ")).resolves.toBe(true);

    expect(sessions.value[0].title).toBe("Local new");
    expect(renameSessionApi).not.toHaveBeenCalled();
  });

  it("calls backend rename and refreshes session list for persisted sessions", async () => {
    const authFetch = vi.fn();
    const ensureConnected = vi.fn(() => true);
    const { actions, renameSessionApi, getSessionsApi } = createHarness({ authFetch, ensureConnected });

    await expect(actions.renameSession("s1", " New title ")).resolves.toBe(true);

    expect(ensureConnected).toHaveBeenCalled();
    expect(renameSessionApi).toHaveBeenCalledWith(
      { userId: "u1", sessionId: "backend-s1", title: "New title" },
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
      id: "s-active",
      backendSessionId: "s-active",
      title: "Active",
      caller: "user",
      loaded: true,
      messages: [activeMessage],
      sessionDocs: [{ sessionId: "s-active", messages: [activeMessage] }],
    };
    const sessions = ref([
      activeSession,
      { id: "s-delete", backendSessionId: "s-delete", title: "Delete", caller: "user" },
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
    const deleteSessionApi = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const getSessionsApi = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessions: [{
          sessionId: "s-active",
          title: "Active",
          caller: "user",
          updatedAt: "2026-01-01T00:01:00.000Z",
        }],
      }),
    });
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
