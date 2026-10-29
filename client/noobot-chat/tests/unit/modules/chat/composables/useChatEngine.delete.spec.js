/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@noobot/shared/request-error";
import {
  activateRuntimeTurn,
  applyMainEntryMessages,
  createHarness,
} from "../helpers/useChatEngineHarness.js";
import {
  AGENT_CHANNEL_STATE,
  SESSION_RUN_EVENT,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import {
  applyTurnRuntimeEvent,
  selectCurrentTurnRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { settleStoppedTurn } from "./useChatEngine.resend-stopped-state.test-helpers.js";
import { NO_ATTACHMENT_EDITS } from "../../../helpers/resendEdits.js";
import {
  deleteSuccessResponse,
  mutationFailureResponse,
} from "../../../helpers/sessionDetailFixture.js";

describe("useChatEngine.delete", () => {
  it("cascadeDeleteMessagesFrom resolves assistant target to user message and removes the user turn", () => {
    const { engine, activeSession } = createHarness({ sessionId: "local-cascade" });
    const first = {
      turnScopeId: "scope-old",
      dialogProcessId: "dp-old",
      role: RoleEnum.USER,
      content: "first",
    };
    const target = {
      turnScopeId: "scope-old",
      dialogProcessId: "dp-old",
      role: RoleEnum.ASSISTANT,
      content: "target",
    };
    const tail = {
      messageUid: "m3",
      turnScopeId: "scope-tail",
      dialogProcessId: "dp-tail",
      role: RoleEnum.USER,
      content: "tail",
    };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [first, target, tail];
    activeSession.value.messageCount = 3;
    activeSession.value.lastMessage = tail;

    expect(engine.cascadeDeleteMessagesFrom(target)).toBe(true);

    expect(activeSession.value.messages).toEqual([]);
    expect(activeSession.value.messageCount).toBe(0);
    expect(activeSession.value.lastMessage).toBe(null);
    expect(activeSession.value.updatedAt).toBeTruthy();
  });

  it("cascadeDeleteMessagesFrom removes matching rawMessages even when they are not the same objects", () => {
    const { engine, activeSession } = createHarness({ sessionId: "local-cascade-raw-copy" });
    const first = {
      messageUid: "m1",
      role: RoleEnum.USER,
      content: "first",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
    };
    const target = {
      presentationMessageId: "m2",
      role: RoleEnum.ASSISTANT,
      content: "target",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
    };
    const tail = {
      messageUid: "m3",
      role: RoleEnum.USER,
      content: "tail",
      turnScopeId: "turn-2",
      dialogProcessId: "dp-2",
    };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [{ ...first }, { ...target }, { ...tail }];
    activeSession.value.messageCount = 3;
    activeSession.value.lastMessage = tail;

    expect(engine.cascadeDeleteMessagesFrom(target)).toBe(true);

    expect(activeSession.value.messages).toEqual([]);
    expect(activeSession.value.messageCount).toBe(0);
    expect(activeSession.value.lastMessage).toBe(null);
  });

  it("deleteMonotonicMessage waits for confirmed stop before cascading deletion from resolved user message", async () => {
    let stopConfirmed = false;
    let stopConfirmedBeforeDelete = false;
    const deleteSessionMessagesFromApi = vi.fn(async () => {
      stopConfirmedBeforeDelete = stopConfirmed;
      return deleteSuccessResponse({
        sessionId: "local-delete",
        turnScopeId: "client-turn:resend-stale",
        aggregateVersion: 1,
        messages: [],
        deletedCount: 2,
        anchorIndex: 0,
      });
    });
    const applySessionDetail = applyMainEntryMessages(() => activeSession);
    const { engine, activeSession, deps, turnRuntimeRegistry } = createHarness({
      sessionId: "local-delete",
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = {
      messageUid: "m1",
      turnScopeId: "client-turn:resend-stale",
      role: RoleEnum.USER,
      content: "first",
    };
    const target = {
      presentationMessageId: "m2",
      turnScopeId: "client-turn:resend-stale",
      role: RoleEnum.ASSISTANT,
      content: "target",
      pending: true,
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "local-delete",
      turnScopeId: target.turnScopeId,
      dialogProcessId: `dp-${target.turnScopeId}`,
    });
    deps.chatWebSocketClient.requestStop.mockImplementation(() => {
      queueMicrotask(() => {
        target.stopState = "user_stopped";
        target.channelState = {
          state: AGENT_CHANNEL_STATE.USER_STOPPED,
          turnScopeId: target.turnScopeId,
          dialogProcessId: target.dialogProcessId,
        };
        settleStoppedTurn(turnRuntimeRegistry, {
          sessionId: "local-delete",
          turnScopeId: target.turnScopeId,
          dialogProcessId: `dp-${target.turnScopeId}`,
        });
        stopConfirmed = true;
      });
      return true;
    });

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).toHaveBeenCalledTimes(1);
    expect(stopConfirmedBeforeDelete).toBe(true);
    expect(activeSession.value.messages).toEqual([]);
  });

  it("resendMonotonicMessage does not continue while stop completion is pending", async () => {
    const stream = vi.fn(async () => {});
    const { engine, activeSession, deps, input, turnRuntimeRegistry } = createHarness({
      sessionId: "local-resend",
      stream,
    });
    const first = {
      messageUid: "m1",
      turnScopeId: "client-turn:resend-no-flicker",
      role: RoleEnum.USER,
      content: "first",
    };
    const target = {
      presentationMessageId: "m2",
      turnScopeId: "client-turn:resend-no-flicker",
      role: RoleEnum.ASSISTANT,
      content: "target",
      pending: true,
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "local-resend",
      turnScopeId: target.turnScopeId,
      dialogProcessId: `dp-${target.turnScopeId}`,
    });
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    await expect(
      engine.resendMonotonicMessage(target, "edited question", NO_ATTACHMENT_EDITS),
    ).rejects.toThrow("chat.monotonicActionStopTimeout");

    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(input.value).toBe("hello");
  });

  it("deleteMonotonicMessage resolves assistant turnScopeId to user anchor and applies backend snapshot", async () => {
    const backendMessages = [
      {
        messageUid: "m1",
        turnScopeId: "client-turn:keep-1",
        role: RoleEnum.USER,
        content: "first",
      },
    ];
    const deleteSessionMessagesFromApi = vi.fn(async () =>
      deleteSuccessResponse({
        sessionId: "local-delete-api",
        turnScopeId: "client-turn:delete-1",
        aggregateVersion: 3,
        messages: backendMessages,
        deletedCount: 2,
        anchorIndex: 1,
      }),
    );
    const applySessionDetail = applyMainEntryMessages(() => activeSession);
    const { engine, activeSession } = createHarness({
      sessionId: "local-delete-api",
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { turnScopeId: "client-turn:delete-1", role: RoleEnum.USER, content: "first" };
    const target = {
      turnScopeId: "client-turn:delete-1",
      role: RoleEnum.ASSISTANT,
      content: "target",
    };
    const tail = {
      messageUid: "m3",
      turnScopeId: "client-turn:delete-tail",
      role: RoleEnum.USER,
      content: "tail",
    };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [first, target, tail];
    activeSession.value.aggregateVersion = 2;

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deleteSessionMessagesFromApi).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: { turnScopeId: "client-turn:delete-1" },
        expectedAggregateVersion: 2,
      }),
      expect.any(Object),
    );
    expect(applySessionDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "local-delete-api",
        sessions: [
          expect.objectContaining({
            sessionId: "local-delete-api",
            messages: backendMessages,
          }),
        ],
      }),
    );
    expect(activeSession.value.messages).toEqual(backendMessages);
  });

  it("deleteMonotonicMessage removes stopped pending tail and applies backend detail", async () => {
    const deleteSessionMessagesFromApi = vi.fn(async () =>
      deleteSuccessResponse({
        sessionId: "local-delete-stopped-tail",
        turnScopeId: "turn-stopped-tail",
        aggregateVersion: 4,
        messages: [],
        deletedCount: 2,
        anchorIndex: 0,
      }),
    );
    const applySessionDetail = applyMainEntryMessages(() => activeSession);
    const { engine, activeSession } = createHarness({
      sessionId: "local-delete-stopped-tail",
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = {
      messageUid: "u1",
      turnScopeId: "turn-stopped-tail",
      role: RoleEnum.USER,
      content: "first",
    };
    const target = {
      presentationMessageId: "a1",
      turnScopeId: "turn-stopped-tail",
      role: RoleEnum.ASSISTANT,
      content: "target",
      pending: true,
      channelState: { state: "stopping", turnScopeId: "turn-stopped-tail" },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.aggregateVersion = 3;

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deleteSessionMessagesFromApi).toHaveBeenCalledTimes(1);
    expect(applySessionDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "local-delete-stopped-tail",
        sessions: [expect.objectContaining({ messages: [] })],
      }),
    );
    expect(activeSession.value.messages).toEqual([]);
  });

  it("deleteMonotonicMessage rejects and keeps local messages when backend returns failure", async () => {
    const deleteSessionMessagesFromApi = vi.fn(async () =>
      mutationFailureResponse({ status: 409, error: "delete rejected" }),
    );
    const { engine, activeSession } = createHarness({
      sessionId: "local-delete-api-fail",
      deps: { deleteSessionMessagesFromApi },
    });
    const first = {
      messageUid: "m1",
      turnScopeId: "turn-delete-api-fail",
      role: RoleEnum.USER,
      content: "first",
    };
    const target = {
      presentationMessageId: "m2",
      turnScopeId: "turn-delete-api-fail",
      role: RoleEnum.ASSISTANT,
      content: "target",
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.aggregateVersion = 2;

    await expect(engine.deleteMonotonicMessage(target)).rejects.toBeInstanceOf(ApiRequestError);

    expect(deleteSessionMessagesFromApi).toHaveBeenCalledTimes(1);
    expect(activeSession.value.messages).toEqual([first, target]);
  });

  it("deleteMonotonicMessage deletes stopped turn when sending state is still stop-requested", async () => {
    const deleteSessionMessagesFromApi = vi.fn(async () =>
      deleteSuccessResponse({
        sessionId: "local-delete-stopped-sending",
        turnScopeId: "turn-stopped-sending",
        aggregateVersion: 8,
        messages: [],
        deletedCount: 2,
        anchorIndex: 0,
      }),
    );
    const applySessionDetail = applyMainEntryMessages(() => activeSession);
    const { engine, activeSession, sending, canStop, turnRuntimeRegistry, deps } = createHarness({
      sessionId: "local-delete-stopped-sending",
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = {
      messageUid: "u1",
      turnScopeId: "turn-stopped-sending",
      dialogProcessId: "dp-stopped-sending",
      role: RoleEnum.USER,
      content: "first",
      stopState: "user_stopped",
      monotonicState: "monotonic",
      isMonotonic: true,
      monotonic: true,
    };
    const target = {
      presentationMessageId: "a1",
      turnScopeId: "turn-stopped-sending",
      dialogProcessId: "dp-stopped-sending",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: true,
      channelState: { state: "stopping", turnScopeId: "turn-stopped-sending" },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [{ ...first }, { ...target }];
    activeSession.value.aggregateVersion = 7;
    applyTurnRuntimeEvent(turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      sessionId: "local-delete-stopped-sending",
      turnScopeId: target.turnScopeId,
      dialogProcessId: target.dialogProcessId,
      source: "test",
    });

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deps.chatWebSocketClient.requestStop).not.toHaveBeenCalled();
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(
      selectCurrentTurnRuntime(turnRuntimeRegistry.value, "local-delete-stopped-sending"),
    ).toBe(null);
    expect(deleteSessionMessagesFromApi).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: { turnScopeId: "turn-stopped-sending" },
        expectedAggregateVersion: 7,
      }),
      expect.any(Object),
    );
    expect(activeSession.value.messages).toEqual([]);
  });

  it("deleteMonotonicMessage does not delete when stop precondition fails", async () => {
    vi.useFakeTimers();
    const { engine, activeSession, deps, turnRuntimeRegistry } = createHarness({
      sessionId: "local-delete-fail",
    });
    const first = {
      messageUid: "m1",
      role: RoleEnum.USER,
      content: "first",
      turnScopeId: "turn-delete-fail",
    };
    const target = {
      presentationMessageId: "m2",
      role: RoleEnum.ASSISTANT,
      content: "target",
      pending: true,
      turnScopeId: "turn-delete-fail",
      channelState: { state: "sending", turnScopeId: "turn-delete-fail" },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "local-delete-fail",
      turnScopeId: "turn-delete-fail",
      dialogProcessId: "dp-turn-delete-fail",
    });
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);
    const actionPromise = engine.deleteMonotonicMessage(target);
    const rejectionExpectation = expect(actionPromise).rejects.toThrow(
      "chat.monotonicActionStopTimeout",
    );
    await vi.advanceTimersByTimeAsync(25);
    await rejectionExpectation;
    expect(activeSession.value.messages).toEqual([first, target]);
    vi.useRealTimers();
  });

  it("resendMonotonicMessage does not delete or send when stop precondition fails", async () => {
    vi.useFakeTimers();
    const stream = vi.fn(async () => {});
    const { engine, activeSession, deps, input, turnRuntimeRegistry } = createHarness({
      sessionId: "local-resend-fail",
      stream,
    });
    const first = {
      messageUid: "m1",
      role: RoleEnum.USER,
      content: "first",
      turnScopeId: "turn-resend-fail",
    };
    const target = {
      presentationMessageId: "m2",
      role: RoleEnum.ASSISTANT,
      content: "target",
      pending: true,
      turnScopeId: "turn-resend-fail",
      channelState: { state: "sending", turnScopeId: "turn-resend-fail" },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "local-resend-fail",
      turnScopeId: "turn-resend-fail",
      dialogProcessId: "dp-turn-resend-fail",
    });
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);
    const actionPromise = engine.resendMonotonicMessage(target, "edited", NO_ATTACHMENT_EDITS);
    const rejectionExpectation = expect(actionPromise).rejects.toThrow(
      "chat.monotonicActionStopTimeout",
    );
    await vi.advanceTimersByTimeAsync(25);
    await rejectionExpectation;
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(stream).not.toHaveBeenCalled();
    expect(input.value).toBe("hello");
    vi.useRealTimers();
  });

  it("clears a deleted stopped turn from the registry so the next send is not continue", async () => {
    const sessionId = "local-delete-stopped-registry";
    const turnScopeId = "turn-stopped-registry";
    const deleteSessionMessagesFromApi = vi.fn(async () =>
      deleteSuccessResponse({
        sessionId,
        turnScopeId,
        aggregateVersion: 5,
        messages: [],
        deletedCount: 2,
        anchorIndex: 0,
      }),
    );
    const applySessionDetail = vi.fn();
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId,
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { messageUid: "u1", turnScopeId, role: RoleEnum.USER, content: "first" };
    const target = {
      presentationMessageId: "a1",
      turnScopeId,
      role: RoleEnum.ASSISTANT,
      content: "target",
      channelState: { state: AGENT_CHANNEL_STATE.USER_STOPPED, turnScopeId },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.aggregateVersion = 4;
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId,
      turnScopeId,
      dialogProcessId: `dp-${turnScopeId}`,
    });
    settleStoppedTurn(turnRuntimeRegistry, {
      sessionId,
      turnScopeId,
      dialogProcessId: `dp-${turnScopeId}`,
    });
    expect(selectCurrentTurnRuntime(turnRuntimeRegistry.value, sessionId)?.terminal).toBe(
      "user_stopped",
    );

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(selectCurrentTurnRuntime(turnRuntimeRegistry.value, sessionId)).toBe(null);
    expect(turnRuntimeRegistry.value.sessions[sessionId]?.turns?.[turnScopeId]).toBeUndefined();
  });
});
