import { describe, expect, it, vi } from "vitest";

import { createSessionListActions } from "../../../../../src/composables/chat/chatList/sessionListActions.js";

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

describe("createSessionListActions.renameSession", () => {
  it("rejects empty titles without calling backend", async () => {
    const { actions, notify, renameSessionApi } = createHarness();

    await expect(actions.renameSession("s1", "   ")).resolves.toBe(false);

    expect(renameSessionApi).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ type: "warning", message: "common.sessionTitleRequired" });
  });

  it("rejects while sending without calling backend", async () => {
    const { actions, notify, renameSessionApi } = createHarness({ sending: ref(true) });

    await expect(actions.renameSession("s1", "New title")).resolves.toBe(false);

    expect(renameSessionApi).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ type: "warning", message: "common.cannotRenameWhileSending" });
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
