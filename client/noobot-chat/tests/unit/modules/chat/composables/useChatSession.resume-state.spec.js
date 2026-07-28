/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useChatStore } from "../../../../src/modules/chat/stores/useChatStore.js";
import { RoleEnum, StreamEventEnum } from "../../../../src/modules/chat/model/chatConstants.js";
import {
  FrontendRunState,
  SESSION_RUN_EVENT,
} from "../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import {
  applyTurnRuntimeEvent,
  selectSessionTurnRuntime,
} from "../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { mapSummaryToSession } from "../../../../src/modules/session/model/list/sessionRecords.js";
import {
  createChatSession,
  createSessionFixture,
  sessionLogClientMock,
  wsClientMock,
} from "./useChatSession.test-helpers.js";

function detailResponse({ sessionId, status, dialogProcessId, turnScopeId }) {
  const payload = detailPayload({ sessionId, status, dialogProcessId, turnScopeId });
  return {
    ok: true,
    json: async () => payload,
  };
}

function detailPayload({ sessionId, status, dialogProcessId, turnScopeId }) {
  return {
    ok: true,
    exists: true,
    sessionId,
    sessions: [{
      sessionId,
      turnStatuses: [{ status, dialogProcessId, turnScopeId }],
      messages: [
        { role: RoleEnum.USER, content: "question", turnScopeId },
        { role: RoleEnum.ASSISTANT, content: "answer", dialogProcessId, turnScopeId },
      ],
    }],
  };
}

function terminalResolution({ sessionId, turnScopeId, state, revision = 2, sequence = 2, startedAt = "" }) {
  const successful = state === "completed" || state === "stop_completed";
  const completionCommitId = `commit:${sessionId}:${turnScopeId}:${revision}`;
  const summaryVersion = 1;
  return {
    ok: true,
    protocolVersion: 1,
    eventType: "turn.terminal_resolved",
    commandId: `resolve:${sessionId}:${turnScopeId}`,
    sessionId,
    turnScopeId,
    resolved: true,
    retryable: false,
    reason: "",
    retryAfterMs: 0,
    turn: {
      sessionId,
      turnScopeId,
      state,
      phase: state === "stop_completed" ? "stop" : "completion",
      revision,
      sequence,
      completionCommitId,
      summaryVersion,
      finalizeIntent: state === "stop_completed" ? "stop" : "complete",
      failure: successful ? null : { stage: state.replace("_failed", ""), retryable: false },
      ...(startedAt ? { startedAt } : {}),
    },
    materialization: {
      sessionVersion: 1,
      terminalStatus: { status: state },
      messages: [],
      completionCommitId,
      summaryVersion,
      revision,
      sequence,
    },
  };
}

function routeAwareFetcher({ detail, terminal }) {
  return vi.fn(async (url) => {
    const payload = String(url).includes("/terminal") ? terminal : detail;
    return { ok: true, json: async () => payload };
  });
}

describe("useChatSession summary and reconnect state", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useChatStore().resetChatStore();
    Object.values(wsClientMock).forEach((fn) => fn?.mockReset?.());
    wsClientMock.reconnect.mockResolvedValue(undefined);
    sessionLogClientMock.log.mockClear();
    sessionLogClientMock.debug.mockClear();
    sessionLogClientMock.dispose.mockClear();
  });

  it("replays an authoritative completed lifecycle snapshot after refresh", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-snapshot", backendSessionId: "s-snapshot",
      turnStatuses: [{ status: "processing", turnScopeId: "t-snapshot", dialogProcessId: "dp-snapshot" }],
      turnLifecycleSnapshot: {
        protocolVersion: 1, eventType: "turn.snapshot", commandId: "summary:s-snapshot:2",
        userId: "", sessionId: "s-snapshot", sequence: 2, activeTurnScopeId: "",
        activeTurn: null, unchanged: false, generatedAt: "2026-07-10T00:00:00.000Z",
        recentTerminalTurns: [{
          turnScopeId: "t-snapshot", dialogProcessId: "dp-snapshot", state: "completed",
          phase: "completion", sequence: 2, revision: 2,
          createdAt: "2026-07-10T00:00:00.000Z", updatedAt: "2026-07-10T00:00:01.000Z",
          capabilities: { canStop: false },
        }],
      },
    })];
    store.activeSessionId = "s-snapshot";

    createChatSession({ authFetch: routeAwareFetcher({
      detail: { ok: true, exists: true, sessionId: "s-snapshot", sessions: [] },
      terminal: terminalResolution({ sessionId: "s-snapshot", turnScopeId: "t-snapshot", state: "completed" }),
    }) });
    await nextTick();
    await vi.waitFor(() => expect(store.turnRuntimeRegistry.sessions["s-snapshot"].turns["t-snapshot"].terminal).toBe("completed"));

    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-snapshot")).toMatchObject({
      sending: false,
      displayState: "send",
    });
    expect(store.turnRuntimeRegistry.sessions["s-snapshot"].protocolVersion).toBe(1);
    expect(store.turnRuntimeRegistry.sessions["s-snapshot"].turns["t-snapshot"].terminal).toBe("completed");
  });

  it("resolves a discovered terminal snapshot before the active Session identity is ready", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "local-refresh-shell",
      backendSessionId: "s-late-identity",
      turnLifecycleSnapshot: {
        protocolVersion: 1,
        eventType: "turn.snapshot",
        commandId: "summary:s-late-identity:2",
        userId: "",
        sessionId: "s-late-identity",
        sequence: 2,
        activeTurnScopeId: "",
        activeTurn: null,
        unchanged: false,
        generatedAt: "2026-07-10T00:00:00.000Z",
        recentTerminalTurns: [{
          turnScopeId: "t-late-identity",
          dialogProcessId: "dp-late-identity",
          state: "completed",
          phase: "completion",
          sequence: 2,
          revision: 2,
          capabilities: { canStop: false },
        }],
      },
    })];
    store.activeSessionId = "";
    const authFetch = routeAwareFetcher({
      detail: { ok: true, exists: true, sessionId: "s-late-identity", sessions: [] },
      terminal: terminalResolution({
        sessionId: "s-late-identity",
        turnScopeId: "t-late-identity",
        state: "completed",
      }),
    });

    createChatSession({ authFetch });
    await vi.waitFor(() => expect(
      store.turnRuntimeRegistry.sessions["s-late-identity"].turns["t-late-identity"].terminal,
    ).toBe("completed"));
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(1);
    store.activeSessionId = "local-refresh-shell";
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(1);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-late-identity")).toMatchObject({
      sending: false,
      canStop: false,
    });
  });

  it("queries the authoritative terminal service for a non-terminal active Turn after refresh", async () => {
    const store = useChatStore();
    const sessionId = "s-active-refresh";
    const turnScopeId = "t-active-refresh";
    store.sessions = [createSessionFixture({
      id: sessionId,
      backendSessionId: sessionId,
      turnLifecycleSnapshot: {
        protocolVersion: 1,
        eventType: "turn.snapshot",
        commandId: "summary:s-active-refresh:4",
        sessionId,
        sequence: 4,
        activeTurnScopeId: turnScopeId,
        activeTurn: {
          sessionId,
          turnScopeId,
          state: "processing",
          phase: "processing",
          revision: 4,
          sequence: 4,
          startedAt: "2026-07-24T05:42:07.698Z",
        },
        recentTerminalTurns: [],
        unchanged: false,
      },
    })];
    store.activeSessionId = sessionId;
    const authFetch = routeAwareFetcher({
      detail: { ok: true, exists: true, sessionId, sessions: [] },
      terminal: terminalResolution({
        sessionId,
        turnScopeId,
        state: "completed",
        revision: 4,
        sequence: 4,
        startedAt: "2026-07-24T05:42:07.698Z",
      }),
    });

    createChatSession({ authFetch });
    await vi.waitFor(() => expect(
      store.turnRuntimeRegistry.sessions[sessionId].turns[turnScopeId].terminal,
    ).toBe("completed"));

    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(1);
    expect(store.turnRuntimeRegistry.sessions[sessionId].turns[turnScopeId].startedAt)
      .toBe("2026-07-24T05:42:07.698Z");
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, sessionId, turnScopeId)).toMatchObject({
      sending: false,
      displayState: "send",
    });
  });

  it("resolves a terminal snapshot when a mapped Session summary arrives asynchronously after startup", async () => {
    const store = useChatStore();
    store.sessions = [];
    store.activeSessionId = "";
    const authFetch = routeAwareFetcher({
      detail: { ok: true, exists: true, sessionId: "s-async-refresh", sessions: [] },
      terminal: terminalResolution({
        sessionId: "s-async-refresh",
        turnScopeId: "t-async-refresh",
        state: "completed",
        revision: 4,
        sequence: 4,
      }),
    });
    createChatSession({ authFetch });

    const summary = {
      sessionId: "s-async-refresh",
      caller: "user",
      messages: [],
      turnLifecycleSnapshot: {
        protocolVersion: 1,
        eventType: "turn.snapshot",
        sessionId: "s-async-refresh",
        sequence: 4,
        activeTurnScopeId: "",
        activeTurn: null,
        recentTerminalTurns: [{
          sessionId: "",
          turnScopeId: "t-async-refresh",
          dialogProcessId: "dp-async-refresh",
          state: "completed",
          phase: "completion",
          revision: 4,
          sequence: 4,
          capabilities: { canStop: false },
        }],
      },
      turnStatuses: [{
        status: "completed",
        turnScopeId: "t-async-refresh",
        dialogProcessId: "dp-async-refresh",
      }],
    };
    store.sessions = [mapSummaryToSession(summary, {
      sessionTitleFromMessages: (_messages, fallback) => fallback,
      createConnectorPanelState: () => ({ selectedConnectors: {} }),
    })];

    await vi.waitFor(() => expect(
      store.turnRuntimeRegistry.sessions["s-async-refresh"]?.turns?.["t-async-refresh"]?.terminal,
    ).toBe("completed"));
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(1);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-async-refresh")).toMatchObject({
      sending: false,
      canStop: false,
      displayState: "send",
    });
  });

  it("projects a cached terminal response through the real Session detail callback without a second query", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "local-pending",
      backendSessionId: "",
      loaded: true,
      messages: [],
    })];
    store.activeSessionId = "local-pending";
    applyTurnRuntimeEvent(store.turnRuntimeRegistry, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "local-pending",
      turnScopeId: "turn-detail-race",
      dialogProcessId: "dp-detail-race",
      source: "test",
    });
    applyTurnRuntimeEvent(store.turnRuntimeRegistry, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId: "local-pending",
      turnScopeId: "turn-detail-race",
      dialogProcessId: "dp-detail-race",
      state: "sending",
      seq: 1,
      source: "test",
    });
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "local-pending")).toMatchObject({
      sending: true,
      canStop: true,
    });

    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({ event: StreamEventEnum.CHANNEL_STATE, data: {
        sessionId: "s-detail-race",
        turnScopeId: "turn-detail-race",
        dialogProcessId: "dp-detail-race",
        state: "completed",
        revision: 2,
        sequence: 2,
        completionCommitId: "commit:s-detail-race:turn-detail-race:2",
        summaryVersion: 1,
      } });
    });
    const detail = detailPayload({
      sessionId: "s-detail-race",
      status: "completed",
      dialogProcessId: "dp-detail-race",
      turnScopeId: "turn-detail-race",
    });
    const terminal = terminalResolution({
      sessionId: "s-detail-race",
      turnScopeId: "turn-detail-race",
      state: "completed",
    });
    const authFetch = routeAwareFetcher({ detail, terminal });
    const session = createChatSession({ authFetch });

    await session.handleReconnect();
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(1);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-detail-race")).toMatchObject({
      sending: false,
      canStop: false,
      terminal: "completed",
    });

    store.sessions.push(createSessionFixture({
      id: "s-detail-race",
      backendSessionId: "s-detail-race",
      loaded: false,
    }));
    await session.selectSession("s-detail-race", { force: true });
    await vi.waitFor(() => expect(
      selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-detail-race").sending,
    ).toBe(false));

    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(1);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-detail-race")).toMatchObject({
      sending: false,
      canStop: false,
      terminal: "completed",
    });
  });

  it("reconciles a completion replayed before processing Turn hydration after refresh", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-processing-race", backendSessionId: "s-processing-race", loaded: false, messages: [],
    })];
    store.activeSessionId = "s-processing-race";
    const turnScopeId = "turn-processing-race";
    const dialogProcessId = "dp-processing-race";
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({ event: StreamEventEnum.CHANNEL_STATE, data: {
        sessionId: "s-processing-race", turnScopeId, dialogProcessId,
        state: "completed", revision: 2, sequence: 2,
        completionCommitId: `commit:s-processing-race:${turnScopeId}:2`, summaryVersion: 1,
      } });
    });
    const detail = detailPayload({
      sessionId: "s-processing-race", status: "processing", dialogProcessId, turnScopeId,
    });
    const terminal = terminalResolution({
      sessionId: "s-processing-race", turnScopeId, state: "completed",
    });
    const authFetch = routeAwareFetcher({ detail, terminal });
    const session = createChatSession({ authFetch });

    await session.handleReconnect();
    await vi.waitFor(() => expect(
      selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-processing-race").terminal,
    ).toBe("completed"));
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(1);

    await session.selectSession("s-processing-race", { force: true });
    await vi.waitFor(() => expect(
      selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-processing-race").terminal,
    ).toBe("completed"));

    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(1);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-processing-race")).toMatchObject({
      sending: false,
      canStop: false,
      terminal: "completed",
    });
  });

  it("keeps dialogProcessId and turnScopeId conversation state keys separate", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-state", backendSessionId: "s-state" })];
    store.activeSessionId = "s-state";
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({ event: StreamEventEnum.CHANNEL_STATE, data: {
        sessionId: "s-state", dialogProcessId: "same-id", state: "sending", seq: 1,
      } });
      onReconnectData({ event: StreamEventEnum.CHANNEL_STATE, data: {
        sessionId: "s-state", turnScopeId: "same-id", state: "completed", seq: 2,
      } });
    });
    const authFetch = vi.fn(async () => ({ ok: true, json: async () => ({
      ok: true, exists: true, sessionId: "s-state", sessions: [], messages: [],
    }) }));
    const session = createChatSession({ authFetch });

    await session.handleReconnect();

    expect(session.conversationStateSnapshot.value["s-state::dialogProcess:same-id"].state).toBe("sending");
    expect(session.conversationStateSnapshot.value["s-state::turnScope:same-id"]).toBeUndefined();
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-state").sending).toBe(false);
  });

  it("does not let a bare backend stopped reconnect acquire the global interaction lock", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-reconnect", backendSessionId: "s-reconnect" })];
    store.activeSessionId = "s-reconnect";
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({ event: StreamEventEnum.CHANNEL_STATE, data: {
        sessionId: "s-reconnect", dialogProcessId: "dp-stop", turnScopeId: "turn-stop", state: "user_stopped",
      } });
    });
    const session = createChatSession();

    await session.handleReconnect();

    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-reconnect").sending).toBe(false);
    expect(session.sending.value).toBe(false);
    expect(session.composerActionState.value.canDeleteMessage).toBe(true);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-reconnect")).toMatchObject({
      sessionId: "s-reconnect", sending: false, canStop: false,
    });
  });

  it("keeps a local stop mutex until the authoritative summary is applied", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-stop",
      backendSessionId: "s-stop",
      loaded: false,
      turnStatuses: [{ status: "user_stopped", turnScopeId: "turn-stop", dialogProcessId: "dp-stop" }],
    })];
    store.activeSessionId = "s-stop";
    applyTurnRuntimeEvent(store.turnRuntimeRegistry, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      sessionId: "s-stop", turnScopeId: "turn-stop", dialogProcessId: "dp-stop", source: "test",
    });
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-stop").displayState).toBe("requesting");
    const authFetch = routeAwareFetcher({
      detail: detailPayload({ sessionId: "s-stop", status: "user_stopped", dialogProcessId: "dp-stop", turnScopeId: "turn-stop" }),
      terminal: terminalResolution({ sessionId: "s-stop", turnScopeId: "turn-stop", state: "stop_completed" }),
    });
    const session = createChatSession({ authFetch });

    await session.selectSession("s-stop", { force: true });
    await nextTick();
    await vi.waitFor(() => expect(session.composerActionState.value.primaryAction).toBe("continue"));

    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-stop").sending).toBe(false);
    expect(store.activeSession.turnStatuses).toEqual([
      expect.objectContaining({ status: "user_stopped", dialogProcessId: "dp-stop", turnScopeId: "turn-stop" }),
    ]);
    expect(session.composerActionState.value).toMatchObject({ primaryAction: "continue", userStopped: true });
  });

  it("restores the continue action from session summary after refresh without a resume cache", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-refresh",
      backendSessionId: "s-refresh",
      loaded: false,
      turnStatuses: [{ status: "user_stopped", turnScopeId: "turn-refresh", dialogProcessId: "dp-refresh" }],
    })];
    store.activeSessionId = "s-refresh";
    const session = createChatSession({ authFetch: routeAwareFetcher({
      detail: detailPayload({ sessionId: "s-refresh", status: "user_stopped", dialogProcessId: "dp-refresh", turnScopeId: "turn-refresh" }),
      terminal: terminalResolution({ sessionId: "s-refresh", turnScopeId: "turn-refresh", state: "stop_completed" }),
    }) });

    await session.selectSession("s-refresh", { force: true });
    await nextTick();
    await vi.waitFor(() => expect(session.composerActionState.value.primaryAction).toBe("continue"));

    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-refresh").sending).toBe(false);
    expect(session.composerActionState.value.primaryAction).toBe("continue");
    expect(session.composerActionState.value.canContinue).toBe(true);
  });

  it.each(["completed", "error", "expired"])(
    "uses normal send when the authoritative summary status is %s",
    async (status) => {
      const store = useChatStore();
      const sessionId = `s-${status}`;
      store.sessions = [createSessionFixture({ id: sessionId, backendSessionId: sessionId, loaded: false })];
      store.activeSessionId = sessionId;
      const terminalState = status === "completed" ? "completed" : "processing_failed";
      const session = createChatSession({ authFetch: routeAwareFetcher({
        detail: detailPayload({ sessionId, status, dialogProcessId: `dp-${status}`, turnScopeId: `turn-${status}` }),
        terminal: terminalResolution({ sessionId, turnScopeId: `turn-${status}`, state: terminalState }),
      }) });

      await session.selectSession(sessionId, { force: true });
      await nextTick();
      await vi.waitFor(() => expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, sessionId).sending).toBe(false));

      expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, sessionId).sending).toBe(false);
      expect(session.composerActionState.value).toMatchObject({ primaryAction: "send", userStopped: false });
    },
  );

  it("does not invent a turn result when completion-summary loading fails", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-fail", backendSessionId: "s-fail", loaded: false, turnStatuses: [] })];
    store.activeSessionId = "s-fail";
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-fail").sending).toBe(false);
    expect(store.activeSession.turnStatuses || []).toEqual([]);
  });

  it("a newer completed message prevents an older stopped turn from becoming the primary action", () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-newer", backendSessionId: "s-newer",
      messages: [
        { role: RoleEnum.ASSISTANT, content: "old", dialogProcessId: "dp-old", turnScopeId: "turn-old" },
        { role: RoleEnum.ASSISTANT, content: "new", dialogProcessId: "dp-new", turnScopeId: "turn-new" },
      ],
      turnStatuses: [
        { status: "user_stopped", dialogProcessId: "dp-old", turnScopeId: "turn-old" },
        { status: "completed", dialogProcessId: "dp-new", turnScopeId: "turn-new" },
      ],
    })];
    store.activeSessionId = "s-newer";
    const session = createChatSession();
    expect(session.composerActionState.value.primaryAction).toBe("send");
  });
});
