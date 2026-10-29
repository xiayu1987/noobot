/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { SESSION_RUN_EVENT } from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import {
  applyTurnRuntimeEvent,
  selectSessionTurnRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
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
  terminalLifecycleSnapshot,
  terminalResolution,
} from "./useChatSession.resume-state.test-helpers.js";
import { jsonResponse } from "../../../helpers/jsonResponse.js";
import { idleTurnLifecycleSnapshot } from "../../../helpers/sessionDetailFixture.js";

describe("useChatSession conversation and composer action state", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useChatStore().resetChatStore();
    Object.values(wsClientMock).forEach((fn) => fn?.mockReset?.());
    wsClientMock.reconnect.mockResolvedValue(undefined);
    sessionLogClientMock.log.mockClear();
    sessionLogClientMock.debug.mockClear();
    sessionLogClientMock.dispose.mockClear();
  });

  it("keeps dialogProcessId and turnScopeId conversation state keys separate", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-state", sessionId: "s-state" })];
    store.activeSessionId = "s-state";
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-state",
          dialogProcessId: "same-id",
          state: "sending",
          seq: 1,
        },
      });
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-state",
          turnScopeId: "same-id",
          state: "completed",
          seq: 2,
        },
      });
    });
    const authFetch = vi.fn(async () =>
      jsonResponse(
        detailPayload({
          sessionId: "s-state",
          dialogProcessId: "same-id",
          turnScopeId: "same-id",
          turnLifecycleSnapshot: idleTurnLifecycleSnapshot("s-state"),
        }),
      ),
    );
    const session = createChatSession({ authFetch });

    await session.handleReconnect();

    expect(
      session.conversationStateSnapshot.value["s-state::dialogProcess:same-id"],
    ).toBeUndefined();
    expect(session.conversationStateSnapshot.value["s-state::turnScope:same-id"]).toBeUndefined();
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-state").sending).toBe(false);
  });

  it("does not let a bare backend stopped reconnect acquire the global interaction lock", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-reconnect", sessionId: "s-reconnect" })];
    store.activeSessionId = "s-reconnect";
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-reconnect",
          dialogProcessId: "dp-stop",
          turnScopeId: "turn-stop",
          state: "user_stopped",
        },
      });
    });
    const session = createChatSession();

    await session.handleReconnect();

    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-reconnect").sending).toBe(false);
    expect(session.sending.value).toBe(false);
    expect(session.composerActionState.value.canDeleteMessage).toBe(true);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-reconnect")).toMatchObject({
      sessionId: "s-reconnect",
      sending: false,
      canStop: false,
    });
  });

  it("keeps a local stop mutex until the authoritative summary is applied", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({
        id: "s-stop",
        sessionId: "s-stop",
        loaded: false,
      }),
    ];
    store.activeSessionId = "s-stop";
    lifecycle(store.turnRuntimeRegistry, {
      sessionId: "s-stop",
      turnScopeId: "turn-stop",
      dialogProcessId: "dp-stop",
      eventType: "turn.action_accepted",
      state: "action_requesting",
      phase: "action",
      executionState: "accepted",
      revision: 1,
      sequence: 1,
      canStop: false,
    });
    lifecycle(store.turnRuntimeRegistry, {
      sessionId: "s-stop",
      turnScopeId: "turn-stop",
      dialogProcessId: "dp-stop",
      revision: 2,
      sequence: 2,
    });
    applyTurnRuntimeEvent(store.turnRuntimeRegistry, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      sessionId: "s-stop",
      turnScopeId: "turn-stop",
      dialogProcessId: "dp-stop",
      source: "test",
    });
    lifecycle(store.turnRuntimeRegistry, {
      sessionId: "s-stop",
      turnScopeId: "turn-stop",
      dialogProcessId: "dp-stop",
      eventType: "turn.stop_accepted",
      state: "action_requesting",
      phase: "stop",
      action: "stop",
      executionState: "accepted",
      revision: 3,
      sequence: 3,
      canStop: false,
      commandId: "stop:turn-stop",
    });

    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-stop").displayState).toBe(
      "requesting",
    );
    const authFetch = routeAwareFetcher({
      detail: detailPayload({
        sessionId: "s-stop",
        dialogProcessId: "dp-stop",
        turnScopeId: "turn-stop",
        turnLifecycleSnapshot: terminalLifecycleSnapshot({
          sessionId: "s-stop",
          turnScopeId: "turn-stop",
          dialogProcessId: "dp-stop",
        }),
      }),
      terminal: terminalResolution({
        sessionId: "s-stop",
        turnScopeId: "turn-stop",
        state: "stop_completed",
        revision: 4,
        sequence: 4,
      }),
    });
    const session = createChatSession({ authFetch });

    await session.selectSession("s-stop", { force: true });
    await nextTick();
    await vi.waitFor(() =>
      expect(session.composerActionState.value.primaryAction).toBe("continue"),
    );

    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-stop").sending).toBe(false);
    expect(store.turnRuntimeRegistry.sessions["s-stop"].turns["turn-stop"].terminal).toBe(
      "user_stopped",
    );
    expect(session.composerActionState.value).toMatchObject({
      primaryAction: "continue",
      userStopped: true,
    });
  });

  it("restores the continue action from session summary after refresh without a resume cache", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({
        id: "s-refresh",
        sessionId: "s-refresh",
        loaded: false,
      }),
    ];
    store.activeSessionId = "s-refresh";
    const session = createChatSession({
      authFetch: routeAwareFetcher({
        detail: detailPayload({
          sessionId: "s-refresh",
          dialogProcessId: "dp-refresh",
          turnScopeId: "turn-refresh",
          turnLifecycleSnapshot: terminalLifecycleSnapshot({
            sessionId: "s-refresh",
            turnScopeId: "turn-refresh",
            dialogProcessId: "dp-refresh",
            revision: 2,
            sequence: 2,
          }),
        }),
        terminal: terminalResolution({
          sessionId: "s-refresh",
          turnScopeId: "turn-refresh",
          state: "stop_completed",
        }),
      }),
    });

    await session.selectSession("s-refresh", { force: true });
    await nextTick();
    await vi.waitFor(() =>
      expect(session.composerActionState.value.primaryAction).toBe("continue"),
    );

    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-refresh").sending).toBe(false);
    expect(session.composerActionState.value.primaryAction).toBe("continue");
    expect(session.composerActionState.value.canContinue).toBe(true);
  });

  it.each(["completed", "error", "expired"])(
    "uses normal send when the authoritative summary status is %s",
    async (status) => {
      const store = useChatStore();
      const sessionId = `s-${status}`;
      store.sessions = [createSessionFixture({ id: sessionId, sessionId, loaded: false })];
      store.activeSessionId = sessionId;
      const terminalState = status === "completed" ? "completed" : "processing_failed";
      const session = createChatSession({
        authFetch: routeAwareFetcher({
          detail: detailPayload({
            sessionId,
            dialogProcessId: `dp-${status}`,
            turnScopeId: `turn-${status}`,
            turnLifecycleSnapshot: idleTurnLifecycleSnapshot(sessionId),
          }),
          terminal: terminalResolution({
            sessionId,
            turnScopeId: `turn-${status}`,
            state: terminalState,
          }),
        }),
      });

      await session.selectSession(sessionId, { force: true });
      await nextTick();
      await vi.waitFor(() =>
        expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, sessionId).sending).toBe(false),
      );

      expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, sessionId).sending).toBe(false);
      expect(session.composerActionState.value).toMatchObject({
        primaryAction: "send",
        userStopped: false,
      });
    },
  );

  it("does not invent a turn result when completion-summary loading fails", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-fail", sessionId: "s-fail", loaded: false })];
    store.activeSessionId = "s-fail";
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-fail").sending).toBe(false);
  });

  it("a newer completed message prevents an older stopped turn from becoming the primary action", () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({
        id: "s-newer",
        sessionId: "s-newer",
        messages: [
          {
            role: RoleEnum.ASSISTANT,
            content: "old",
            dialogProcessId: "dp-old",
            turnScopeId: "turn-old",
          },
          {
            role: RoleEnum.ASSISTANT,
            content: "new",
            dialogProcessId: "dp-new",
            turnScopeId: "turn-new",
          },
        ],
      }),
    ];
    store.activeSessionId = "s-newer";
    const session = createChatSession();
    expect(session.composerActionState.value.primaryAction).toBe("send");
  });
});
