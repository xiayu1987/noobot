/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  activateRuntimeTurn,
  makeSession,
  makeTurnReplacementResponse,
  assistantMessage,
  emitChannelState,
  emitAuthorityProcessing,
  emitAuthorityTerminal,
} from "../helpers/useChatEngineHarness.js";
import { BackendChannelState, FrontendRunState } from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { SESSION_RUN_EVENT } from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { applyTurnTerminalResolution, selectSessionTurnRuntime } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { createTurnTerminalResolution } from "@noobot/event-protocol";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../../src/modules/chat/model/chatConstants.js";

function settleStoppedTurn(turnRuntimeRegistry, { sessionId, turnScopeId, messages = [] }) {
  const revision = 100;
  const sequence = 100;
  const completionCommitId = `commit-${turnScopeId}-${revision}`;
  const result = applyTurnTerminalResolution(turnRuntimeRegistry.value, createTurnTerminalResolution({
    commandId: `resolve-${turnScopeId}-${revision}`,
    sessionId,
    turnScopeId,
    resolved: true,
    turn: {
      sessionId,
      turnScopeId,
      state: "stop_completed",
      phase: "stop",
      revision,
      sequence,
      completionCommitId,
      summaryVersion: revision,
      capabilities: { actionLocked: false, canStop: false },
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    materialization: {
      completionCommitId,
      summaryVersion: revision,
      revision,
      sequence,
      terminalStatus: { status: "stop_completed" },
      messages,
    },
  }));
  if (result?.applied && result.registry) {
    turnRuntimeRegistry.value = { ...result.registry };
  }
  return result;
}

describe("useChatEngine.resend stopped state", () => {
  it("resendMonotonicMessage rejects stale stopped replacement snapshots without the new turnScopeId", async () => {
    const stream = vi.fn(async (payload, onEvent) => emitAuthorityProcessing(onEvent, {
      ...payload,
      sessionId: "local-resend-repeat-stopped",
    }));
    const staleStoppedUser = {
      turnScopeId: "client-turn:stopped-old",
      role: RoleEnum.USER,
      content: "stopped question",
      stopState: "user_stopped",
      monotonicState: "monotonic",
    };
    const staleStoppedAssistant = {
      turnScopeId: "client-turn:stopped-old",
      role: RoleEnum.ASSISTANT,
      content: "partial stopped",
      statusLabel: "chat.stopped",
      stopState: "user_stopped",
    };
    const replaceSessionTurnApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-stale-stopped", {
        messages: [staleStoppedUser, staleStoppedAssistant],
        rawMessages: [staleStoppedUser, staleStoppedAssistant],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "local-resend-stale-stopped",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    activeSession.value.messages = [staleStoppedUser, staleStoppedAssistant];
    activeSession.value.rawMessages = [staleStoppedUser, staleStoppedAssistant];

    await expect(engine.resendMonotonicMessage(staleStoppedAssistant, "edited again")).resolves.toBe(false);

    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([staleStoppedUser, staleStoppedAssistant]);
  });

  it("resendMonotonicMessage can repeatedly replace a stopped turn and append a fresh assistant placeholder", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, idempotencyKey, anchor, expectedVersion }) => {
      const replacementUser = {
        id: `msg-user-${turnScopeId}`,
        messageId: `msg-user-${turnScopeId}`,
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
        dialogProcessId: "",
      };
      return makeTurnReplacementResponse({
        commandId: idempotencyKey,
        sessionId: "local-resend-repeat-stopped",
        version: Number(expectedVersion || 0) + 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "local-resend-repeat-stopped",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:repeat-old",
      role: RoleEnum.USER,
      content: "first stopped",
      stopState: "user_stopped",
      monotonicState: "monotonic",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:repeat-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      statusLabel: "chat.stopped",
      stopState: "user_stopped",
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];

    await expect(engine.resendMonotonicMessage(stoppedAssistant, "second resend")).resolves.toBe(true);

    const [replacementUser, placeholder] = activeSession.value.messages;
    expect(replacementUser).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "second resend",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(replacementUser.stopState).toBeUndefined();
    expect(placeholder).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: false,
      turnScopeId: replacementUser.turnScopeId,
    }));
    expect(placeholder.statusLabel).toBe("");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("can stop and edit-resend twice through persisted USER_STOPPED events", async () => {
    const sessionId = "local-resend-two-real-stops";
    const stoppedTurns = [];
    const stream = vi.fn(async (payload, onEvent) => {
      const index = stoppedTurns.length + 1;
      const dialogProcessId = `dp-resend-stop-${index}`;
      stoppedTurns.push({
        turnScopeId: payload.turnScopeId,
        dialogProcessId,
        content: payload.message,
      });
      emitChannelState(onEvent, sessionId, dialogProcessId, "sending", {
        turnScopeId: payload.turnScopeId,
      });
      emitAuthorityProcessing(onEvent, {
        ...payload,
        sessionId,
        dialogProcessId,
      });
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: {
          sessionId,
          dialogProcessId,
          turnScopeId: payload.turnScopeId,
          turnStatus: {
            status: "user_stopped",
            dialogProcessId,
            turnScopeId: payload.turnScopeId,
          },
        },
      });
      emitAuthorityTerminal(onEvent, {
        sessionId,
        turnScopeId: payload.turnScopeId,
        dialogProcessId,
        state: "stop_completed",
        sequence: index + 2,
        revision: index + 2,
      });
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, idempotencyKey, anchor, expectedVersion }) => {
      const replacementUser = {
        id: `msg-user-${turnScopeId}`,
        messageId: `msg-user-${turnScopeId}`,
        role: RoleEnum.USER,
        content: newContent,
        turnScopeId,
        dialogProcessId: "",
      };
      return makeTurnReplacementResponse({
        commandId: idempotencyKey,
        sessionId,
        version: Number(expectedVersion || 0) + 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
      });
    });
    const fetchSessionDetail = vi.fn(async () => {
      const stopped = stoppedTurns[stoppedTurns.length - 1];
      const user = {
        role: RoleEnum.USER,
        content: stopped.content,
        turnScopeId: stopped.turnScopeId,
      };
      const assistant = {
        role: RoleEnum.ASSISTANT,
        content: "partial",
        pending: false,
        statusLabel: "chat.stopped",
        turnScopeId: stopped.turnScopeId,
        dialogProcessId: stopped.dialogProcessId,
        channelState: {
          state: "user_stopped",
          turnScopeId: stopped.turnScopeId,
          dialogProcessId: stopped.dialogProcessId,
        },
      };
      return {
        sessionId,
        sessions: [makeSession(sessionId, {
          messages: [user, assistant],
          rawMessages: [user, assistant],
          turnStatuses: [{
            status: "user_stopped",
            turnScopeId: stopped.turnScopeId,
            dialogProcessId: stopped.dialogProcessId,
          }],
        })],
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const session = detail.sessions?.[0];
      if (session) activeSession.value = { ...activeSession.value, ...session };
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId,
      stream,
      terminalResolutionState: "stop_completed",
      deps: { replaceSessionTurnApi, fetchSessionDetail, applySessionDetail },
    });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "original", turnScopeId: "client-turn:original" },
      {
        role: RoleEnum.ASSISTANT,
        content: "partial original",
        pending: false,
        turnScopeId: "client-turn:original",
        dialogProcessId: "dp-original",
        channelState: { state: "user_stopped", turnScopeId: "client-turn:original", dialogProcessId: "dp-original" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];

    await expect(engine.resendMonotonicMessage(activeSession.value.messages[1], "first edit")).resolves.toBe(true);
    const firstStoppedAssistant = activeSession.value.messages.find((message) => message.role === RoleEnum.ASSISTANT);
    await expect(engine.resendMonotonicMessage(firstStoppedAssistant, "second edit")).resolves.toBe(true);
    const secondReplaceScope = replaceSessionTurnApi.mock.calls[1][0].turnScopeId;

    expect(stream).toHaveBeenCalledTimes(2);
    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(2);
    const firstReplaceScope = replaceSessionTurnApi.mock.calls[0][0].turnScopeId;
    const committedSecondReplaceScope = replaceSessionTurnApi.mock.calls[1][0].turnScopeId;
    expect(firstReplaceScope).not.toBe(committedSecondReplaceScope);
    expect(stream.mock.calls[0][0].turnScopeId).toBe(firstReplaceScope);
    expect(stream.mock.calls[1][0].turnScopeId).toBe(committedSecondReplaceScope);
    expect(stoppedTurns[0].dialogProcessId).not.toBe(stoppedTurns[1].dialogProcessId);
    const secondRuntime = selectSessionTurnRuntime(turnRuntimeRegistry.value, sessionId, secondReplaceScope);
    expect(secondRuntime).toMatchObject({
      // Authority state stop_completed is intentionally projected to the
      // client presentation terminal user_stopped.
      terminal: "user_stopped",
      turnScopeId: committedSecondReplaceScope,
      sending: false,
    });
    expect(secondRuntime.lifecycleEventType).toBe("turn.stop_completed");
  });

  it("resendMonotonicMessage keeps the second replacement turn running instead of inheriting stopped state", async () => {
    const stream = vi.fn(async (payload, onEvent) => emitAuthorityProcessing(onEvent, {
      ...payload,
      sessionId: "local-resend-second-stopped",
    }));
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, idempotencyKey, anchor, expectedVersion }) => {
      const replacementUser = {
        id: `msg-user-${turnScopeId}`,
        messageId: `msg-user-${turnScopeId}`,
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
        dialogProcessId: "",
      };
      return makeTurnReplacementResponse({
        commandId: idempotencyKey,
        sessionId: "local-resend-second-stopped",
        version: Number(expectedVersion || 0) + 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, activeTurnRuntime, sending, canStop, turnRuntimeRegistry } = createHarness({
      sessionId: "local-resend-second-stopped",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    activeSession.value.messages = [
      {
        turnScopeId: "client-turn:old",
        role: RoleEnum.USER,
        content: "first stopped",
        stopState: "user_stopped",
      },
      {
        turnScopeId: "client-turn:old",
        role: RoleEnum.ASSISTANT,
        content: "partial",
        pending: false,
        statusLabel: "chat.stopped",
        stopState: "user_stopped",
        channelState: { state: "user_stopped", turnScopeId: "client-turn:old" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];

    await expect(engine.resendMonotonicMessage(activeSession.value.messages[1], "second")).resolves.toBe(true);
    const firstReplacementUser = activeSession.value.messages[0];
    const firstReplacementAssistant = activeSession.value.messages[1];
    const firstTurnScopeId = firstReplacementUser.turnScopeId;

    firstReplacementUser.stopState = "stopped";
    firstReplacementUser.monotonicState = "monotonic";
    firstReplacementAssistant.pending = false;
    firstReplacementAssistant.statusLabel = "chat.stopped";
    firstReplacementAssistant.stopState = "stopped";
    firstReplacementAssistant.channelState = { state: "user_stopped", turnScopeId: firstTurnScopeId };
    settleStoppedTurn(turnRuntimeRegistry, {
      sessionId: "local-resend-second-stopped",
      turnScopeId: firstTurnScopeId,
      messages: activeSession.value.messages,
    });
    await expect(engine.resendMonotonicMessage(firstReplacementAssistant, "third")).resolves.toBe(true);

    const [secondReplacementUser, secondPlaceholder] = activeSession.value.messages;
    expect(secondReplacementUser.turnScopeId).toMatch(/^client-turn:/);
    expect(secondReplacementUser.turnScopeId).not.toBe(firstTurnScopeId);
    expect(secondReplacementUser.stopState).toBeUndefined();
    expect(secondPlaceholder).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: false,
      statusLabel: "",
      turnScopeId: secondReplacementUser.turnScopeId,
    }));
    expect(secondPlaceholder.stopState).toBeUndefined();
    expect(secondPlaceholder.channelState?.state).not.toBe("user_stopped");
    expect(activeTurnRuntime.value.state).toBe(FrontendRunState.PROCESSING);
    expect(activeTurnRuntime.value.backendState).toBe(BackendChannelState.SENDING);
    expect(activeTurnRuntime.value.turnScopeId).toBeTruthy();
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("ignores stale message-level stopped state when explicit runtime state allows a second replacement", async () => {
    let streamCallCount = 0;
    const stream = vi.fn(async (payload, onEvent) => {
      streamCallCount += 1;
      emitAuthorityProcessing(onEvent, {
        ...payload,
        sessionId: "local-resend-stale-stop-replay",
      });
      if (streamCallCount === 2) {
        emitChannelState(onEvent, "local-resend-stale-stop-replay", "dp-old-stopped", "user_stopped", {
          turnScopeId: payload.turnScopeId,
        });
      }
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, idempotencyKey, anchor, expectedVersion }) => {
      const replacementUser = {
        id: `msg-user-${turnScopeId}`,
        messageId: `msg-user-${turnScopeId}`,
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
        dialogProcessId: "",
      };
      const messages = [
            {
              turnScopeId: "client-turn:history",
              role: RoleEnum.USER,
              content: "historical stopped",
              dialogProcessId: "dp-old-stopped",
              stopState: "user_stopped",
            },
            {
              turnScopeId: "client-turn:history",
              role: RoleEnum.ASSISTANT,
              content: "historical partial",
              pending: false,
              statusLabel: "chat.stopped",
              dialogProcessId: "dp-old-stopped",
              channelState: { state: "user_stopped", dialogProcessId: "dp-old-stopped", turnScopeId: "client-turn:history" },
            },
            replacementUser,
          ];
      return makeTurnReplacementResponse({
        commandId: idempotencyKey,
        sessionId: "local-resend-stale-stop-replay",
        version: Number(expectedVersion || 0) + 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
        messages,
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, activeTurnRuntime, sending, canStop, turnRuntimeRegistry } = createHarness({
      sessionId: "local-resend-stale-stop-replay",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    activeSession.value.messages = [
      { turnScopeId: "client-turn:first", role: RoleEnum.USER, content: "first", stopState: "user_stopped" },
      {
        turnScopeId: "client-turn:first",
        role: RoleEnum.ASSISTANT,
        content: "partial",
        pending: false,
        statusLabel: "chat.stopped",
        channelState: { state: "user_stopped", turnScopeId: "client-turn:first" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];

    await expect(engine.resendMonotonicMessage(activeSession.value.messages[1], "second")).resolves.toBe(true);
    const firstAssistant = activeSession.value.messages.find((message) => (
      message.role === RoleEnum.ASSISTANT && message.turnScopeId !== "client-turn:history"
    ));
    firstAssistant.pending = false;
    firstAssistant.statusLabel = "chat.stopped";
    firstAssistant.channelState = { state: "user_stopped", turnScopeId: firstAssistant.turnScopeId };
    settleStoppedTurn(turnRuntimeRegistry, {
      sessionId: "local-resend-stale-stop-replay",
      turnScopeId: firstAssistant.turnScopeId,
      messages: activeSession.value.messages,
    });

    await expect(engine.resendMonotonicMessage(firstAssistant, "third")).resolves.toBe(true);

    const freshPlaceholder = [...activeSession.value.messages]
      .reverse()
      .find((message) => message.role === RoleEnum.ASSISTANT && message.turnScopeId === activeTurnRuntime.value.turnScopeId);
    expect(freshPlaceholder).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      pending: false,
      turnScopeId: activeTurnRuntime.value.turnScopeId,
    }));
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
  });

  it("resendMonotonicMessage ignores stale global run state when Registry has no active turn", async () => {
    const stream = vi.fn(async (payload, onEvent) => emitAuthorityProcessing(onEvent, {
      ...payload,
      sessionId: "local-resend-ignore-stale-assistant",
    }));
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, idempotencyKey, anchor, expectedVersion }) => {
      const replacementUser = { id: `msg-user-${turnScopeId}`, messageId: `msg-user-${turnScopeId}`, turnScopeId, role: RoleEnum.USER, content: newContent };
      return makeTurnReplacementResponse({
        commandId: idempotencyKey,
        sessionId: "local-resend-state-mismatch",
        version: Number(expectedVersion || 0) + 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, activeTurnRuntime, sending, canStop, deps } = createHarness({
      sessionId: "local-resend-state-mismatch",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.USER,
      content: "old stopped",
      stopState: "user_stopped",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: false,
      statusLabel: "chat.stopped",
      channelState: { state: "user_stopped", turnScopeId: "client-turn:old-stopped" },
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    await expect(engine.resendMonotonicMessage(stoppedAssistant, "retry")).resolves.toBe(true);

    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(deps.notify).not.toHaveBeenCalledWith(expect.objectContaining({
      message: "chat.sessionStateOutOfSync",
    }));
  });

  it("resendMonotonicMessage ignores stale stopped assistants after the new replacement user", async () => {
    const stream = vi.fn(async () => {});
    const staleStoppedAssistant = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.ASSISTANT,
      content: "old stopped partial",
      statusLabel: "chat.stopped",
      stopState: "user_stopped",
    };
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, idempotencyKey, anchor, expectedVersion }) => {
      const replacementUser = {
        id: `msg-user-${turnScopeId}`,
        messageId: `msg-user-${turnScopeId}`,
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
      };
      return makeTurnReplacementResponse({
        commandId: idempotencyKey,
        sessionId: "local-resend-ignore-stale-assistant",
        version: Number(expectedVersion || 0) + 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-ignore-stale-assistant",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const oldUser = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.USER,
      content: "old",
      stopState: "user_stopped",
    };
    activeSession.value.messages = [oldUser, staleStoppedAssistant];
    activeSession.value.rawMessages = [oldUser, staleStoppedAssistant];

    await expect(engine.resendMonotonicMessage(staleStoppedAssistant, "new attempt")).resolves.toBe(true);

    const replacementUser = activeSession.value.messages.find((message) => message.role === RoleEnum.USER);
    const latestAssistant = activeSession.value.messages[activeSession.value.messages.length - 1];
    expect(latestAssistant).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: false,
      turnScopeId: replacementUser.turnScopeId,
      statusLabel: "",
    }));
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
