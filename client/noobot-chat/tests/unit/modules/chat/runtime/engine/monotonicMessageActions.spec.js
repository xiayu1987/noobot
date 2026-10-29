/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createMonotonicMessageActions } from "../../../../../../src/modules/chat/runtime/engine/monotonicMessageActions.js";
import { SESSION_RUN_EVENT } from "../../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { RoleEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";
import {
  applyTurnRuntimeEvent,
  createTurnRuntimeRegistryState,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { lifecycle } from "../run-state-machine/turnRuntimeRegistryTestFixtures.js";
import { createPendingMessageOperationStore } from "../../../../../../src/modules/chat/runtime/engine/messageOperationStore.js";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { selectMainSessionDetailEntry } from "@noobot/session-protocol/session-detail";
import {
  deleteSuccessResponse,
  mutationFailureResponse,
} from "../../../../helpers/sessionDetailFixture.js";

function createActions({
  turnRuntimeRegistry = ref(createTurnRuntimeRegistryState()),
  activeSessionId = ref("s1"),
  stopSending = vi.fn(),
  applyRunStateEvent = vi.fn(),
} = {}) {
  const userMessage = {
    messageUid: "u1",
    role: RoleEnum.USER,
    content: "hello",
    turnScopeId: "turn-1",
    ts: "2026-07-02T00:00:00.000Z",
  };
  const assistantMessage = {
    presentationMessageId: "a1",
    role: RoleEnum.ASSISTANT,
    content: "world",
    turnScopeId: "turn-1",
    ts: "2026-07-02T00:00:01.000Z",
  };
  const activeSession = ref({
    sessionId: "s1",
    parentSessionId: "",
    messages: [userMessage, assistantMessage],
    rawMessages: [userMessage, assistantMessage],
    aggregateVersion: 1,
  });
  const deleteSessionMessagesFromApi = vi.fn(async () =>
    deleteSuccessResponse({
      sessionId: "s1",
      turnScopeId: "turn-1",
      aggregateVersion: 2,
      messages: [],
      deletedCount: 2,
      anchorIndex: 0,
    }),
  );
  const applySessionDetail = vi.fn((detail) => {
    const mainEntry = selectMainSessionDetailEntry(detail);
    activeSession.value = {
      ...activeSession.value,
      messages: [...mainEntry.messages],
      aggregateVersion: mainEntry.aggregateVersion,
    };
  });
  const actions = createMonotonicMessageActions({
    activeSession,
    activeSessionId,
    authFetch: vi.fn(),
    clearPendingInteraction: vi.fn(),
    deleteSessionMessagesFromApi,
    replaceSessionTurnApi: vi.fn(),
    input: ref(""),
    notify: vi.fn(),
    send: vi.fn(),
    sending: ref(false),
    canStop: ref(false),
    stopSending,
    translate: (key) => key,
    userId: ref("user-1"),
    applySessionDetail,
    turnRuntimeRegistry,
    messageOperationStore: createPendingMessageOperationStore(),
    chatWebSocketClient: { cancelStreamForTurn: vi.fn() },
    invalidateTerminalResolution: vi.fn(),
    removeWorkflowOwnersForReplacedTurns: vi.fn(() => ({
      removedWorkflowRunIds: [],
      removedSessionIds: [],
    })),
    monotonicActionStopTimeoutMs: 1,
    monotonicActionStopPollIntervalMs: 1,
    applyRunStateEvent,
  });
  return {
    actions,
    activeSession,
    activeSessionId,
    stopSending,
    userMessage,
    deleteSessionMessagesFromApi,
    applySessionDetail,
    applyRunStateEvent,
  };
}

describe("monotonicMessageActions stop-window gates", () => {
  it("does not delete messages while the session run state machine is waiting for stop completion", async () => {
    const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
    lifecycle(turnRuntimeRegistry.value, {
      sessionId: "s1",
      turnScopeId: "turn-1",
      eventType: "turn.action_accepted",
      state: "action_requesting",
      phase: "action",
      executionState: "accepted",
      revision: 1,
      sequence: 1,
      canStop: false,
    });
    lifecycle(turnRuntimeRegistry.value, {
      sessionId: "s1",
      turnScopeId: "turn-1",
      revision: 2,
      sequence: 2,
    });
    applyTurnRuntimeEvent(turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      sessionId: "s1",
      turnScopeId: "turn-1",
    });
    lifecycle(turnRuntimeRegistry.value, {
      sessionId: "s1",
      turnScopeId: "turn-1",
      eventType: "turn.stop_accepted",
      state: "stopping",
      phase: "stop",
      action: "stop",
      executionState: "accepted",
      revision: 3,
      sequence: 3,
      canStop: false,
      commandId: "stop:turn-1",
    });
    const { actions, activeSession, userMessage, deleteSessionMessagesFromApi } = createActions({
      turnRuntimeRegistry,
    });

    const result = await actions.deleteMonotonicMessage(userMessage);

    expect(result).toBe(false);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toHaveLength(2);
  });

  it("allows delete again after the backend stop terminal state releases the gate", async () => {
    const { actions, userMessage, deleteSessionMessagesFromApi } = createActions();

    const result = await actions.deleteMonotonicMessage(userMessage);

    expect(result).toBe(true);
    expect(deleteSessionMessagesFromApi).toHaveBeenCalledTimes(1);
  });

  it("applies the conflict version and retries delete-from once", async () => {
    const { actions, activeSession, userMessage, deleteSessionMessagesFromApi } = createActions();
    deleteSessionMessagesFromApi
      .mockResolvedValueOnce(
        mutationFailureResponse({
          status: 409,
          error: "session version conflict",
          errorCode: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
          currentVersion: 2,
        }),
      )
      .mockResolvedValueOnce(
        deleteSuccessResponse({
          sessionId: "s1",
          turnScopeId: "turn-1",
          aggregateVersion: 3,
          messages: [],
          deletedCount: 2,
          anchorIndex: 0,
        }),
      );

    const result = await actions.deleteMonotonicMessage(userMessage);

    expect(result).toBe(true);
    expect(activeSession.value.aggregateVersion).toBe(3);
    expect(deleteSessionMessagesFromApi).toHaveBeenCalledTimes(2);
    expect(deleteSessionMessagesFromApi.mock.calls[0][0].expectedAggregateVersion).toBe(1);
    expect(deleteSessionMessagesFromApi.mock.calls[1][0].expectedAggregateVersion).toBe(2);
  });

  it("applies the detail aggregate version after deleting a stopped turn", async () => {
    const { actions, activeSession, userMessage } = createActions();

    expect(await actions.deleteMonotonicMessage(userMessage)).toBe(true);
    expect(activeSession.value.aggregateVersion).toBe(2);
  });

  it("deletes a stopped turn after its authoritative summary clears the temporary lock", async () => {
    const applyRunStateEvent = vi.fn();
    const { actions, activeSession, userMessage } = createActions({
      applyRunStateEvent,
    });

    expect(await actions.deleteMonotonicMessage(userMessage)).toBe(true);
    expect(activeSession.value.messages).toHaveLength(0);
    expect(applyRunStateEvent).not.toHaveBeenCalled();
  });

  it("does not delete when the active session switches while waiting for the running turn to stop", async () => {
    const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
    lifecycle(turnRuntimeRegistry.value, {
      sessionId: "s1",
      turnScopeId: "turn-1",
      eventType: "turn.action_accepted",
      state: "action_requesting",
      phase: "action",
      executionState: "accepted",
      revision: 1,
      sequence: 1,
      canStop: false,
    });
    lifecycle(turnRuntimeRegistry.value, {
      sessionId: "s1",
      turnScopeId: "turn-1",
      revision: 2,
      sequence: 2,
    });
    const activeSessionId = ref("s1");
    const stopSending = vi.fn(() => {
      activeSessionId.value = "s2";
    });
    const { actions, activeSession, userMessage, deleteSessionMessagesFromApi } = createActions({
      turnRuntimeRegistry,
      activeSessionId,
      stopSending,
    });

    const result = await actions.deleteMonotonicMessage(userMessage);

    expect(stopSending).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toHaveLength(2);
  });

  it("does not delete when the active session is removed while waiting for the running turn to stop", async () => {
    const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
    lifecycle(turnRuntimeRegistry.value, {
      sessionId: "s1",
      turnScopeId: "turn-1",
      eventType: "turn.action_accepted",
      state: "action_requesting",
      phase: "action",
      executionState: "accepted",
      revision: 1,
      sequence: 1,
      canStop: false,
    });
    lifecycle(turnRuntimeRegistry.value, {
      sessionId: "s1",
      turnScopeId: "turn-1",
      revision: 2,
      sequence: 2,
    });
    const stopSending = vi.fn(() => {
      turnRuntimeRegistry.value = createTurnRuntimeRegistryState();
      harness.activeSession.value = null;
    });
    const harness = createActions({ turnRuntimeRegistry, stopSending });
    const { actions, userMessage, deleteSessionMessagesFromApi } = harness;

    await expect(actions.deleteMonotonicMessage(userMessage)).resolves.toBe(false);

    expect(stopSending).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
  });

  it("resolves a same-turn assistant message to its user message", () => {
    const { actions, activeSession, userMessage } = createActions();
    const assistantMessage = activeSession.value.messages[1];

    const resolvedFromUser = actions.resolveMonotonicUserTarget(userMessage);
    const resolvedFromAssistant = actions.resolveMonotonicUserTarget(assistantMessage);

    expect(resolvedFromUser.messageUid).toBe(userMessage.messageUid);
    expect(resolvedFromAssistant.messageUid).toBe(userMessage.messageUid);
    expect(resolvedFromAssistant.role).toBe(RoleEnum.USER);
  });

  it("returns null when no user message shares the target turn", () => {
    const { actions } = createActions();

    expect(
      actions.resolveMonotonicUserTarget({
        role: RoleEnum.ASSISTANT,
        content: "orphan",
        turnScopeId: "turn-other",
      }),
    ).toBeNull();
    expect(actions.resolveMonotonicUserTarget(null)).toBeNull();
  });

  it("returns null for a non-user target when there is no active session", () => {
    const { actions, activeSession, activeSessionId } = createActions();
    const assistantMessage = activeSession.value.messages[1];
    activeSession.value = null;
    activeSessionId.value = "";

    expect(actions.resolveMonotonicUserTarget(assistantMessage)).toBeNull();
  });

  it("does not call the delete API when the active session is cleared", async () => {
    const { actions, activeSession, activeSessionId, userMessage, deleteSessionMessagesFromApi } =
      createActions();
    activeSession.value = null;
    activeSessionId.value = "";

    expect(await actions.deleteMonotonicMessage(userMessage)).toBe(false);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
  });
});
