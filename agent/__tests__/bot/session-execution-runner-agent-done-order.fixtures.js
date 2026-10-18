/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTurnAcceptanceReceipt } from "@noobot/session-protocol";
import { createAcceptedRunIdentity } from "../helpers/accepted-run-identity.js";
import { text, isObjectLike } from "@noobot/shared/value";
import { SessionExecutionRunner } from "../../src/bot/execution/runner.js";
import { finalizeAgentTurn } from "../../src/bot/execution/runner/result-finalizer.js";
import { createCurrentTurnMessagesStore } from "../../src/runtime/turn/current-turn-ledger.js";
import {
  AGENT_LIFECYCLE_BRANCH_STATE,
  AGENT_LIFECYCLE_STATE,
} from "../../src/runtime/lifecycle/state-machine.js";
import { AGENT_RUN_EVENT } from "../../src/events/run-event.js";
import { loadStoppedModelMessageSnapshot } from "../../src/runtime/resume/model-message-snapshot-store.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";

export function createRunner({
  callOrder,
  eventListener = { onEvent() {} },
  finalizeRunSession,
  agentRunner,
  runConfig = {},
  prepareAgentTurnExecution,
  runtime,
  getSessionTurns = async () => [],
  getTurnSummaryCheckpointState = async () => null,
  appendAgentMessages = async () => [],
}) {
  const defaultRuntime = runtime || { attachmentMetas: [] };
  let authorityEventSequence = 0;
  const sessionManager = {
    async commitMessageEvent({
      sessionId,
      turnScopeId,
      messageId,
      commandId,
      correlationId,
      payload,
    }) {
      authorityEventSequence += 1;
      return {
        committed: true,
        envelope: createEventEnvelope({
          family: EVENT_FAMILY.MESSAGE_TIMELINE,
          identity: {
            eventId: `test-authority-event-${authorityEventSequence}`,
            eventType: MESSAGE_EVENT_WIRE_EVENT,
            sessionId,
            turnScopeId,
            messageId,
          },
          causality: { commandId, correlationId },
          ordering: {
            domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
            scopeId: messageId,
            sequence: authorityEventSequence,
          },
          producer: { type: "test", id: "session-execution-runner-fixture" },
          occurredAt: "2026-05-21T00:00:00.000Z",
          payload,
        }),
      };
    },
  };
  defaultRuntime.sessionManager = defaultRuntime.sessionManager || sessionManager;
  if (!defaultRuntime.currentTurnMessages) {
    defaultRuntime.currentTurnMessages = createCurrentTurnMessagesStore([]);
  }
  const acceptedUserMessages = new Map();
  const runner = new SessionExecutionRunner({
    agentRunner:
      agentRunner ||
      (async () => {
        callOrder.push("agentRunner");
        return {
          output: "ok",
          assistantMessageId: "message-test-assistant",
          traces: [{ id: "trace-1" }],
          turnMessages: [
            {
              messageId: "message-test-assistant",
              role: "assistant",
              type: "message",
              content: "ok",
            },
          ],
          turnTasks: [],
        };
      }),
    errorLogger: {
      async log() {
        callOrder.push("errorLogger.log");
      },
    },
    normalizeRunMessage: (message) => message,
    validateRunInput: () => {},
    ensureParentAsyncResultContainer: () => null,
    initializeRunSessionRuntime: async () => ({
      usedSessionId: "session-used",
      dialogProcessId: "dialog-1",
      sessionLoadState: "created",
      userConfig: {},
      currentSessionModelAlias: "",
      runtimeEventListener: { flush: async () => {}, ...eventListener },
    }),
    resolveScenarioRunConfig: (runConfig) => runConfig,
    prepareRunConfig: ({ runConfig: inputRunConfig }) => ({
      ...inputRunConfig,
      ...runConfig,
    }),
    buildContextBuilder: () => ({ kind: "context-builder" }),
    prepareTurnInput: async ({ buildContextPayload }) => ({
      userMessageAttachments: buildContextPayload.userMessageAttachments,
    }),
    assertPersistenceContextIdentity: () => {},
    bindSessionTurnAttachments: async () => {
      throw new Error("attachment binding is not part of this fixture");
    },
    prepareAgentTurnExecution: async (payload) => {
      const prepared = prepareAgentTurnExecution
        ? await prepareAgentTurnExecution(payload)
        : await (async () => {
            const agentContext = createTestAgentExecutionScope(defaultRuntime, {
              identity: { dialogProcessId: "dialog-1", turnScopeId: "turn-default" },
            });
            return { agentContext, runtimeAgentContext: agentContext };
          })();
      const preparedRuntime = prepared?.runtimeAgentContext?.bindings?.runtime;
      if (isObjectLike(preparedRuntime)) {
        preparedRuntime.sessionManager = preparedRuntime.sessionManager || sessionManager;
      }
      return prepared;
    },
    assertReusedUserTurnIdentity: async (payload = {}) => {
      callOrder?.push("assertReusedUserTurnIdentity");
      return { userMessage: acceptedUserMessages.get(text(payload.turnScopeId)) };
    },
    getSessionTurns,
    getTurnSummaryCheckpointState,
    appendAgentMessages,
    finalizeRunSession,
    saveExecutionReport: async () => {},
    getExecutionTurnLogs: async () => [],
    upsertParentAsyncTask: () => {
      callOrder.push("upsertParentAsyncTask");
    },
    now: () => "2026-05-21T00:00:00.000Z",
  });
  runner.runAcceptedSession = (request = {}) => {
    const turnScopeId = text(request.turnScopeId);
    const acceptedRunConfig = createAcceptedRunIdentity(turnScopeId, request.runConfig);
    const messageUid = `sm_test_${turnScopeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    acceptedUserMessages.set(turnScopeId, {
      messageUid,
      messageId: acceptedRunConfig.userMessageId,
      role: "user",
      type: "message",
      content: request.message,
      userName: request.userId,
      sessionId: "session-used",
      dialogProcessId: "dialog-1",
      turnScopeId,
      messageOrigin: "natural",
      userMetaMaterialized: true,
      attachments: [],
    });
    return runner.runSession({
      ...request,
      turnScopeId,
      runConfig: acceptedRunConfig,
      turnAcceptance: createTurnAcceptanceReceipt({
        commandId: acceptedRunConfig.commandId,
        sessionId: "session-used",
        turnScopeId,
        dialogProcessId: "dialog-1",
        messageUid,
        aggregateVersion: 1,
      }),
    });
  };
  return runner;
}

export function collectLifecycleStates(events) {
  return events
    .filter((item) => item.event === AGENT_RUN_EVENT.LIFECYCLE_STATE_CHANGED)
    .map((item) => item.data.state);
}

export function findStoppedLifecycleEvent(events) {
  return events.find(
    (item) =>
      item.event === AGENT_RUN_EVENT.LIFECYCLE_STATE_CHANGED &&
      item.data?.state === AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED,
  );
}

export {
  assert,
  fs,
  os,
  path,
  finalizeAgentTurn,
  AGENT_LIFECYCLE_BRANCH_STATE,
  AGENT_LIFECYCLE_STATE,
  AGENT_RUN_EVENT,
  loadStoppedModelMessageSnapshot,
  createCurrentTurnMessagesStore,
  createTestAgentExecutionScope,
};
