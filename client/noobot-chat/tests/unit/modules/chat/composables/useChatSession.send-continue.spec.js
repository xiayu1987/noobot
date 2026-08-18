/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { applyTurnTerminalResolution } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { createTurnTerminalResolution } from "@noobot/session-protocol";
import {
  createChatSession,
  createSessionFixture,
  sessionLogClientMock,
  wsClientMock,
} from "./useChatSession.test-helpers.js";
import { lifecycle } from "../runtime/run-state-machine/turnRuntimeRegistryTestFixtures.js";

function turnMessages({
  dialogProcessId = "dp-1",
  turnScopeId = "turn-1",
  content = "answer",
} = {}) {
  return [
    { role: "user", content: "question", turnScopeId },
    { role: "assistant", content, dialogProcessId, turnScopeId },
  ];
}

function sessionWithTurn(_status, overrides = {}) {
  const dialogProcessId = overrides.dialogProcessId || "dp-1";
  const turnScopeId = overrides.turnScopeId || "turn-1";
  return createSessionFixture({
    id: overrides.id || "s-1",
    sessionId: overrides.sessionId || overrides.id || "s-1",
    messages: overrides.messages || turnMessages({ dialogProcessId, turnScopeId }),
    ...overrides,
  });
}

function settleStopped(store, session) {
  const sessionId = session.sessionId || session.id;
  const assistant = session.messages.findLast((message) => message.role === "assistant");
  const turnScopeId = assistant.turnScopeId;
  const revision = 100;
  const completionCommitId = `commit-${turnScopeId}`;
  return applyTurnTerminalResolution(
    store.turnRuntimeRegistry,
    createTurnTerminalResolution({
      commandId: `resolve-${turnScopeId}`,
      sessionId,
      turnScopeId,
      resolved: true,
      aggregateVersion: Number(session.aggregateVersion || 0),
      turn: {
        sessionId,
        turnScopeId,
        dialogProcessId: assistant.dialogProcessId,
        state: "stop_completed",
        phase: "stop",
        revision,
        sequence: revision,
        completionCommitId,
        summaryVersion: revision,
        capabilities: { actionLocked: false, canStop: false },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      materialization: {
        completionCommitId,
        summaryVersion: revision,
        revision,
        sequence: revision,
        terminalStatus: { status: "stop_completed" },
        messages: session.messages,
      },
    }),
  );
}

describe("useChatSession send/continue actions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useChatStore().resetChatStore();
    Object.values(wsClientMock).forEach((fn) => fn?.mockReset?.());
    wsClientMock.reconnect.mockResolvedValue(undefined);
    sessionLogClientMock.log.mockClear();
    sessionLogClientMock.debug.mockClear();
    sessionLogClientMock.dispose.mockClear();
  });

  it("derives sending controls from the last in-flight message and rejects a duplicate action", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-send", sessionId: "s-send" })];
    store.activeSessionId = "s-send";
    store.input = "hello";
    wsClientMock.stream.mockReturnValue(new Promise(() => {}));
    const session = createChatSession();

    session.send();
    await nextTick();

    const turnScopeId = store.turnRuntimeRegistry.sessions["s-send"].activeTurnScopeId;
    lifecycle(store.turnRuntimeRegistry, {
      sessionId: "s-send",
      turnScopeId,
      eventType: "turn.action_accepted",
      state: "action_requesting",
      phase: "action",
      executionState: "accepted",
      revision: 1,
      sequence: 1,
      canStop: false,
    });
    lifecycle(store.turnRuntimeRegistry, {
      sessionId: "s-send",
      turnScopeId,
      revision: 2,
      sequence: 2,
    });

    expect(session.composerActionState.value.displayState).toBe("sending");
    expect(session.composerActionState.value.canStop).toBe(true);
    expect(session.composerActionState.value.sendRequesting).toBe(false);
    expect(await session.send()).toBe(false);
    expect(wsClientMock.stream).toHaveBeenCalledTimes(1);
  });

  it("allows the first send through the composer lock without reporting a state mismatch", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-first-send", sessionId: "s-first-send" })];
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
    settleStopped(store, current);
    expect(session.composerActionState.value).toMatchObject({
      primaryAction: "continue",
      userStopped: true,
    });
  });

  it("continues with the stopped identity as resume source and a fresh turnScopeId", async () => {
    const store = useChatStore();
    store.sessions = [
      sessionWithTurn("user_stopped", {
        sessionId: "backend-session",
        dialogProcessId: "dp-stopped",
        turnScopeId: "turn-stopped",
      }),
    ];
    store.activeSessionId = "backend-session";
    store.input = "continue";
    wsClientMock.stream.mockImplementation(async (payload, _onEvent, options) => {
      options?.onPayloadSent?.(payload);
      return {};
    });
    const session = createChatSession();
    settleStopped(store, store.sessions[0]);

    expect(session.composerActionState.value.primaryAction).toBe("continue");
    expect(await session.send()).toBe(true);
    const payload = wsClientMock.stream.mock.calls[0][0];
    expect(payload.identity.sessionId).toBe("backend-session");
    expect(payload.commandType).toBe("turn.continue");
    expect(payload.continuation).toMatchObject({
      dialogProcessId: "dp-stopped",
      turnScopeId: "turn-stopped",
    });
    expect(payload.preferences).not.toHaveProperty("thinkingStartedAt");
    expect(payload.identity.turnScopeId).toMatch(/^client-turn:/);
    expect(payload.identity.turnScopeId).not.toBe("turn-stopped");
    expect(session.sending.value).toBe(true);
  });

  it("sends a new turn instead of continuing an older stopped turn after completion", async () => {
    const store = useChatStore();
    const oldMessages = turnMessages({ dialogProcessId: "dp-old", turnScopeId: "turn-old" });
    const newMessages = turnMessages({ dialogProcessId: "dp-new", turnScopeId: "turn-new" });
    const current = createSessionFixture({
      id: "s-latest-terminal",
      sessionId: "s-latest-terminal",
      messages: [...oldMessages, ...newMessages],
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
    expect(payload.commandType).toBe("turn.send");
    expect(payload.continuation).toBeUndefined();
  });

  it("does not continue when the stopped status lacks a complete matching identity", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({
        id: "s-incomplete",
        sessionId: "s-incomplete",
        messages: [{ role: "assistant", content: "partial", turnScopeId: "turn-only" }],
      }),
    ];
    store.activeSessionId = "s-incomplete";
    store.input = "continue";
    const session = createChatSession();

    expect(session.composerActionState.value.primaryAction).toBe("send");
    expect(await session.send()).toBe(true);
    expect(wsClientMock.stream).toHaveBeenCalledTimes(1);
    expect(wsClientMock.stream.mock.calls[0][0].commandType).toBe("turn.send");
  });
});
