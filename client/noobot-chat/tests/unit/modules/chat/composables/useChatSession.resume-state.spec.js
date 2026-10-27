/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { SESSION_RUN_EVENT } from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import {
  applyTurnRuntimeEvent,
  projectTurnRuntimeView,
  selectSessionTurnRuntime,
  selectTurnRuntimeByScope,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { mapSummaryToSession } from "../../../../../src/modules/session/model/list/sessionRecords.js";
import {
  createChatSession,
  createSessionFixture,
  sessionLogClientMock,
  wsClientMock,
} from "./useChatSession.test-helpers.js";
import { lifecycle } from "../runtime/run-state-machine/turnRuntimeRegistryTestFixtures.js";
import {
  detailPayload,
  routeAwareFetcher,
  terminalResolution,
} from "./useChatSession.resume-state.test-helpers.js";
import { terminalStatusFixture } from "../helpers/terminalStatusFixture.js";
import { ROOT_PARENT_SESSION_ID } from "@noobot/agent-transport-protocol";

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
    store.sessions = [
      createSessionFixture({
        id: "s-snapshot",
        sessionId: "s-snapshot",

        turnLifecycleSnapshot: {
          protocolVersion: 1,
          eventType: "turn.snapshot",
          recovery: "none",
          commandId: "summary:s-snapshot:2",
          userId: "",
          sessionId: "s-snapshot",
          sequence: 2,
          activeTurnScopeId: "",
          activeTurn: null,
          unchanged: false,
          generatedAt: "2026-07-10T00:00:00.000Z",
          replacedTurns: [],
          recentTerminalTurns: [
            {
              sessionId: "s-snapshot",
              turnScopeId: "t-snapshot",
              dialogProcessId: "dp-snapshot",
              state: "completed",
              presentationMessageId: "msg-t-snapshot",
              phase: "completion",
              sequence: 2,
              revision: 2,
              createdAt: "2026-07-10T00:00:00.000Z",
              updatedAt: "2026-07-10T00:00:01.000Z",
              capabilities: { canStop: false },
            },
          ],
        },
      }),
    ];
    store.activeSessionId = "s-snapshot";

    createChatSession({
      authFetch: routeAwareFetcher({
        detail: { ok: true, exists: true, sessionId: "s-snapshot", sessions: [] },
        terminal: terminalResolution({
          sessionId: "s-snapshot",
          turnScopeId: "t-snapshot",
          state: "completed",
        }),
      }),
    });
    await nextTick();
    await vi.waitFor(() =>
      expect(store.turnRuntimeRegistry.sessions["s-snapshot"].turns["t-snapshot"].terminal).toBe(
        "completed",
      ),
    );

    expect(
      projectTurnRuntimeView(
        "s-snapshot",
        selectTurnRuntimeByScope(store.turnRuntimeRegistry, "s-snapshot", "t-snapshot"),
      ),
    ).toMatchObject({
      sending: false,
      displayState: "",
    });
    expect(store.turnRuntimeRegistry.sessions["s-snapshot"].turns["t-snapshot"].terminal).toBe(
      "completed",
    );
  });

  it("replays an action failure before message persistence as terminal after refresh", async () => {
    const store = useChatStore();
    const sessionId = "s-action-failure";
    const turnScopeId = "t-action-failure";
    store.sessions = [
      createSessionFixture({
        id: sessionId,
        sessionId,
        turnLifecycleSnapshot: {
          protocolVersion: 1,
          eventType: "turn.snapshot",
          recovery: "none",
          commandId: `summary:${sessionId}:2`,
          sessionId,
          sequence: 2,
          activeTurnScopeId: "",
          activeTurn: null,
          unchanged: false,
          generatedAt: "2026-07-10T00:00:01.000Z",
          replacedTurns: [],
          recentTerminalTurns: [
            {
              sessionId,
              turnScopeId,
              dialogProcessId: "dp-action-failure",
              state: "action_failed",
              executionState: "error",
              presentationMessageId: `msg-${turnScopeId}`,
              phase: "action",
              sequence: 2,
              revision: 2,
              terminalStatus: terminalStatusFixture("action_failed", {
                turnScopeId,
                dialogProcessId: "dp-action-failure",
              }),
              failure: { code: "ATTACHMENT_REJECTED" },
              capabilities: { canStop: false },
            },
          ],
        },
      }),
    ];
    store.activeSessionId = sessionId;

    createChatSession({
      authFetch: routeAwareFetcher({
        detail: { ok: true, exists: true, sessionId, sessions: [] },
      }),
    });
    await nextTick();
    await vi.waitFor(() =>
      expect(store.turnRuntimeRegistry.sessions[sessionId].turns[turnScopeId].terminal).toBe(
        "error",
      ),
    );

    expect(
      projectTurnRuntimeView(
        sessionId,
        selectTurnRuntimeByScope(store.turnRuntimeRegistry, sessionId, turnScopeId),
      ),
    ).toMatchObject({
      sending: false,
      canStop: false,
    });
  });

  it("resolves a discovered terminal snapshot before the active Session identity is ready", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({
        id: "local-refresh-shell",
        sessionId: "s-late-identity",
        turnLifecycleSnapshot: {
          protocolVersion: 1,
          eventType: "turn.snapshot",
          recovery: "none",
          commandId: "summary:s-late-identity:2",
          userId: "",
          sessionId: "s-late-identity",
          sequence: 2,
          activeTurnScopeId: "",
          activeTurn: null,
          unchanged: false,
          replacedTurns: [],
          generatedAt: "2026-07-10T00:00:00.000Z",
          recentTerminalTurns: [
            {
              sessionId: "s-late-identity",
              turnScopeId: "t-late-identity",
              presentationMessageId: "msg-t-late-identity",
              dialogProcessId: "dp-late-identity",
              state: "completed",
              phase: "completion",
              sequence: 2,
              revision: 2,
              capabilities: { canStop: false },
            },
          ],
        },
      }),
    ];
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
    await vi.waitFor(() =>
      expect(
        store.turnRuntimeRegistry.sessions["s-late-identity"].turns["t-late-identity"].terminal,
      ).toBe("completed"),
    );
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(
      0,
    );
    store.activeSessionId = "local-refresh-shell";
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(
      0,
    );
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-late-identity")).toMatchObject({
      sending: false,
      canStop: false,
    });
  });

  it("queries the authoritative terminal service for a non-terminal active Turn after refresh", async () => {
    const store = useChatStore();
    const sessionId = "s-active-refresh";
    const turnScopeId = "t-active-refresh";
    store.sessions = [
      createSessionFixture({
        id: sessionId,
        sessionId,
        turnLifecycleSnapshot: {
          protocolVersion: 1,
          eventType: "turn.snapshot",
          recovery: "none",
          commandId: "summary:s-active-refresh:4",
          sessionId,
          sequence: 4,
          activeTurnScopeId: turnScopeId,
          replacedTurns: [],
          activeTurn: {
            sessionId,
            turnScopeId,
            dialogProcessId: `dp-${turnScopeId}`,
            presentationMessageId: `msg-${turnScopeId}`,
            state: "processing",
            phase: "processing",
            revision: 4,
            sequence: 4,
            startedAt: "2026-07-24T05:42:07.698Z",
          },
          recentTerminalTurns: [],
          unchanged: false,
        },
      }),
    ];
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
    await vi.waitFor(() =>
      expect(store.turnRuntimeRegistry.sessions[sessionId].turns[turnScopeId].terminal).toBe(
        "completed",
      ),
    );

    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(
      1,
    );
    expect(store.turnRuntimeRegistry.sessions[sessionId].turns[turnScopeId].startedAt).toBe(
      "2026-07-24T05:42:07.698Z",
    );
    expect(
      projectTurnRuntimeView(
        sessionId,
        selectTurnRuntimeByScope(store.turnRuntimeRegistry, sessionId, turnScopeId),
      ),
    ).toMatchObject({
      sending: false,
      displayState: "",
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
      parentSessionId: ROOT_PARENT_SESSION_ID,
      caller: "user",
      messages: [],
      turnLifecycleSnapshot: {
        protocolVersion: 1,
        eventType: "turn.snapshot",
        recovery: "none",
        commandId: "summary:s-async-refresh:4",
        sessionId: "s-async-refresh",
        sequence: 4,
        unchanged: false,
        activeTurnScopeId: "",
        activeTurn: null,
        replacedTurns: [],
        recentTerminalTurns: [
          {
            sessionId: "s-async-refresh",
            turnScopeId: "t-async-refresh",
            presentationMessageId: "msg-t-async-refresh",
            dialogProcessId: "dp-async-refresh",
            state: "completed",
            phase: "completion",
            revision: 4,
            sequence: 4,
            capabilities: { canStop: false },
          },
        ],
      },
    };
    store.sessions = [
      mapSummaryToSession(summary, {
        sessionTitleFromMessages: (_messages, fallback) => fallback,
        createConnectorPanelState: () => ({ selectedConnectorIds: [], connectors: [] }),
      }),
    ];

    await vi.waitFor(() =>
      expect(
        store.turnRuntimeRegistry.sessions["s-async-refresh"]?.turns?.["t-async-refresh"]?.terminal,
      ).toBe("completed"),
    );
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(
      0,
    );
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-async-refresh")).toMatchObject({
      sending: false,
      canStop: false,
      displayState: "",
    });
  });

  it("ignores a transport channel_state without an Authority terminal record", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({
        id: "local-pending",
        sessionId: "local-pending",
        isLocal: true,
        loaded: true,
        messages: [],
      }),
    ];
    store.activeSessionId = "local-pending";
    applyTurnRuntimeEvent(store.turnRuntimeRegistry, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "local-pending",
      turnScopeId: "turn-detail-race",
      dialogProcessId: "dp-detail-race",
      source: "test",
    });
    lifecycle(store.turnRuntimeRegistry, {
      sessionId: "local-pending",
      turnScopeId: "turn-detail-race",
      dialogProcessId: "dp-detail-race",
      eventType: "turn.action_accepted",
      state: "action_requesting",
      phase: "action",
      executionState: "accepted",
      revision: 1,
      sequence: 1,
      canStop: false,
    });
    lifecycle(store.turnRuntimeRegistry, {
      sessionId: "local-pending",
      turnScopeId: "turn-detail-race",
      dialogProcessId: "dp-detail-race",
      revision: 2,
      sequence: 2,
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
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-detail-race",
          turnScopeId: "turn-detail-race",
          dialogProcessId: "dp-detail-race",
          state: "completed",
          revision: 2,
          sequence: 2,
          completionCommitId: "commit:s-detail-race:turn-detail-race:2",
          summaryVersion: 1,
        },
      });
    });
    const detail = detailPayload({
      sessionId: "s-detail-race",
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
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(
      0,
    );
    expect(
      projectTurnRuntimeView(
        "s-detail-race",
        selectTurnRuntimeByScope(store.turnRuntimeRegistry, "s-detail-race", "turn-detail-race"),
      ),
    ).toMatchObject({
      sending: false,
      canStop: false,
    });

    store.sessions.push(
      createSessionFixture({
        id: "s-detail-race",
        sessionId: "s-detail-race",
        loaded: false,
      }),
    );
    await session.selectSession("s-detail-race", { force: true });
    await nextTick();

    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(
      0,
    );
    expect(
      projectTurnRuntimeView(
        "s-detail-race",
        selectTurnRuntimeByScope(store.turnRuntimeRegistry, "s-detail-race", "turn-detail-race"),
      ),
    ).toMatchObject({
      sending: false,
      canStop: false,
    });
  });

  it("does not reconcile completion from a transport channel_state before Turn hydration", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({
        id: "s-processing-race",
        sessionId: "s-processing-race",
        loaded: false,
        messages: [],
      }),
    ];
    store.activeSessionId = "s-processing-race";
    const turnScopeId = "turn-processing-race";
    const dialogProcessId = "dp-processing-race";
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-processing-race",
          turnScopeId,
          dialogProcessId,
          state: "completed",
          revision: 2,
          sequence: 2,
          completionCommitId: `commit:s-processing-race:${turnScopeId}:2`,
          summaryVersion: 1,
        },
      });
    });
    const detail = detailPayload({
      sessionId: "s-processing-race",
      dialogProcessId,
      turnScopeId,
    });
    const terminal = terminalResolution({
      sessionId: "s-processing-race",
      turnScopeId,
      state: "completed",
    });
    const authFetch = routeAwareFetcher({ detail, terminal });
    const session = createChatSession({ authFetch });

    await session.handleReconnect();
    await nextTick();
    expect(
      projectTurnRuntimeView(
        "s-processing-race",
        selectTurnRuntimeByScope(store.turnRuntimeRegistry, "s-processing-race", turnScopeId),
      ).terminal,
    ).toBeNull();
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(
      0,
    );

    await session.selectSession("s-processing-race", { force: true });
    await nextTick();

    expect(authFetch.mock.calls.filter(([url]) => String(url).includes("/terminal"))).toHaveLength(
      0,
    );
    expect(
      projectTurnRuntimeView(
        "s-processing-race",
        selectTurnRuntimeByScope(store.turnRuntimeRegistry, "s-processing-race", turnScopeId),
      ),
    ).toMatchObject({
      terminal: null,
    });
  });
});
