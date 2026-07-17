import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useChatStore } from "../../../../src/shared/stores/useChatStore";
import {
  createChatSession,
  createSessionFixture,
  sessionLogClientMock,
  wsClientMock,
} from "./useChatSession.test-helpers.js";

function turnMessages({ dialogProcessId = "dp-1", turnScopeId = "turn-1", content = "answer" } = {}) {
  return [
    { role: "user", content: "question", turnScopeId },
    { role: "assistant", content, dialogProcessId, turnScopeId },
  ];
}

function sessionWithTurn(status, overrides = {}) {
  const dialogProcessId = overrides.dialogProcessId || "dp-1";
  const turnScopeId = overrides.turnScopeId || "turn-1";
  return createSessionFixture({
    id: overrides.id || "s-1",
    backendSessionId: overrides.backendSessionId || overrides.id || "s-1",
    messages: overrides.messages || turnMessages({ dialogProcessId, turnScopeId }),
    turnStatuses: status ? [{ status, dialogProcessId, turnScopeId }] : [],
    ...overrides,
  });
}

describe("useChatSession send/continue actions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useChatStore().resetChatStore();
    Object.values(wsClientMock).forEach((fn) => fn?.mockReset?.());
    wsClientMock.isStopRequested.mockReturnValue(false);
    wsClientMock.reconnect.mockResolvedValue(undefined);
    sessionLogClientMock.log.mockClear();
    sessionLogClientMock.debug.mockClear();
    sessionLogClientMock.dispose.mockClear();
  });

  it("derives sending controls from the last in-flight message and rejects a duplicate action", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-send", backendSessionId: "s-send" })];
    store.activeSessionId = "s-send";
    store.input = "hello";
    wsClientMock.stream.mockReturnValue(new Promise(() => {}));
    const session = createChatSession();

    session.send();
    await nextTick();

    expect(session.composerActionState.value.displayState).toBe("sending");
    expect(session.composerActionState.value.canStop).toBe(true);
    expect(session.composerActionState.value.sendRequesting).toBe(false);
    expect(await session.send()).toBe(false);
    // The first action reaches transport; the last in-flight message prevents
    // the duplicate without relying on a global interaction lock.
    expect(wsClientMock.stream).toHaveBeenCalledTimes(1);
  });

  it("allows the first send through the composer lock without reporting a state mismatch", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-first-send", backendSessionId: "s-first-send" })];
    store.activeSessionId = "s-first-send";
    store.input = "hello";
    wsClientMock.stream.mockResolvedValue({});
    const session = createChatSession();

    await expect(session.send()).resolves.toBe(true);

    expect(wsClientMock.stream).toHaveBeenCalledTimes(1);
  });

  it.each(["completed", "error", "expired", undefined])(
    "derives normal send from the Session turn Registry for terminal status %s",
    (status) => {
      const store = useChatStore();
      const current = sessionWithTurn(status);
      store.sessions = [current];
      store.activeSessionId = current.id;
      const session = createChatSession();
      expect(session.composerActionState.value).toMatchObject({
        primaryAction: "send",
        userStopped: false,
      });
    },
  );

  it("derives continue from the Session turn Registry's authoritative user_stopped terminal", () => {
    const store = useChatStore();
    const current = sessionWithTurn("user_stopped");
    store.sessions = [current];
    store.activeSessionId = current.id;
    const session = createChatSession();
    expect(session.composerActionState.value).toMatchObject({
      primaryAction: "continue",
      userStopped: true,
    });
  });

  it("continues with the stopped identity as resume source and a fresh turnScopeId", async () => {
    const store = useChatStore();
    store.sessions = [sessionWithTurn("user_stopped", {
      id: "local-session",
      backendSessionId: "backend-session",
      dialogProcessId: "dp-stopped",
      turnScopeId: "turn-stopped",
    })];
    store.activeSessionId = "local-session";
    store.input = "continue";
    wsClientMock.stream.mockImplementation(async (payload, _onEvent, options) => {
      options?.onPayloadSent?.(payload);
      return {};
    });
    const session = createChatSession();

    expect(session.composerActionState.value.primaryAction).toBe("continue");
    expect(await session.send()).toBe(true);
    const payload = wsClientMock.stream.mock.calls[0][0];
    expect(payload.sessionId).toBe("backend-session");
    expect(payload.action).toBe("continue");
    expect(payload.config).toMatchObject({
      resumeDialogProcessId: "dp-stopped",
      resumeTurnScopeId: "turn-stopped",
      stoppedTurnScopeId: "turn-stopped",
    });
    expect(payload.turnScopeId).toMatch(/^client-turn:/);
    expect(payload.turnScopeId).not.toBe("turn-stopped");
    expect(store.runStateSnapshot).not.toHaveProperty("dialogProcessId");
    expect(store.runStateSnapshot).not.toHaveProperty("turnScopeId");
  });

  it("sends a new turn instead of continuing an older stopped turn after completion", async () => {
    const store = useChatStore();
    const oldMessages = turnMessages({ dialogProcessId: "dp-old", turnScopeId: "turn-old" });
    const newMessages = turnMessages({ dialogProcessId: "dp-new", turnScopeId: "turn-new" });
    const current = createSessionFixture({
      id: "s-latest-terminal",
      backendSessionId: "s-latest-terminal",
      messages: [...oldMessages, ...newMessages],
      turnStatuses: [
        { status: "user_stopped", dialogProcessId: "dp-old", turnScopeId: "turn-old" },
        { status: "completed", dialogProcessId: "dp-new", turnScopeId: "turn-new" },
      ],
    });
    store.sessions = [current];
    store.activeSessionId = current.id;
    store.input = "next question";
    wsClientMock.stream.mockResolvedValue({});
    const session = createChatSession();
    expect(session.composerActionState.value).toMatchObject({
      primaryAction: "send",
      userStopped: false,
    });
    await expect(session.send()).resolves.toBe(true);
    const payload = wsClientMock.stream.mock.calls[0][0];
    expect(payload.action).toBeUndefined();
    expect(payload.config.resumeDialogProcessId).toBeUndefined();
    expect(payload.config.resumeTurnScopeId).toBeUndefined();
  });

  it("does not continue when the stopped status lacks a complete matching identity", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-incomplete",
      backendSessionId: "s-incomplete",
      messages: [{ role: "assistant", content: "partial", turnScopeId: "turn-only" }],
      turnStatuses: [{ status: "user_stopped", turnScopeId: "turn-only" }],
    })];
    store.activeSessionId = "s-incomplete";
    store.input = "continue";
    const session = createChatSession();

    expect(session.composerActionState.value.primaryAction).toBe("continue");
    expect(await session.send()).toBe(false);
    expect(wsClientMock.stream).not.toHaveBeenCalled();
  });
});
