/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEmptyTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import assert from "node:assert/strict";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTurnAcceptanceReceipt } from "@noobot/session-protocol";
import { createAcceptedRunIdentity } from "../helpers/accepted-run-identity.js";
import { text } from "@noobot/shared/value";
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
import { projectAgentContextIdentity } from "../../src/context/agent-context-envelope-input.js";
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { TEST_MESSAGE_TS, createTestSessionRunPayload } from "../helpers/session-run-payload.js";
import { createAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";

export function createRunner({
  callOrder,
  eventListener = { onEvent() {} },
  finalizeRunSession,
  agentRunner,
  runConfig = {},
  observePreparedTurn,
  runtime,
  getSessionTurns = async () => [],
  getTurnSummaryCheckpointState = async ({ dialogProcessId, turnScopeId }) =>
    createEmptyTurnSummaryCheckpointState({ dialogProcessId, turnScopeId }),
  appendAgentMessages = async ({ messages = [] } = {}) => messages,
}) {
  let authorityEventSequence = 0;
  const sessionManager = {
    async commitMessageEvent({ sessionId, turnScopeId, commandId, correlationId, payload }) {
      authorityEventSequence += 1;
      return {
        committed: true,
        envelope: createEventEnvelope({
          family: EVENT_FAMILY.MESSAGE_TIMELINE,
          schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
          identity: {
            eventId: `test-authority-event-${authorityEventSequence}`,
            eventType: MESSAGE_EVENT_WIRE_EVENT,
            sessionId,
            turnScopeId,
          },
          causality: { commandId, correlationId },
          ordering: {
            domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
            scopeId: payload.presentationMessageId,
            sequence: authorityEventSequence,
          },
          producer: { type: "test", id: "session-execution-runner-fixture" },
          occurredAt: "2026-05-21T00:00:00.000Z",
          payload,
        }),
      };
    },
  };

  const bindTestRuntime = (target) => {
    target.sessionManager = sessionManager;
    target.currentTurnMessages = createCurrentTurnMessagesStore([]);
    return target;
  };
  if (runtime) bindTestRuntime(runtime);
  const acceptedUserMessages = new Map();
  const runner = new SessionExecutionRunner({
    agentRunner:
      agentRunner ||
      (async () => {
        callOrder.push("agentRunner");
        return createAgentTurnResult({
          output: "ok",
          modelMessageId: "message-test-assistant",
          traces: [{ id: "trace-1" }],
          turnMessages: [
            {
              messageUid: "sm_test-assistant",
              modelMessageId: "message-test-assistant",
              role: "assistant",
              type: "message",
              content: "ok",
            },
          ],
          turnTasks: [],
          modelMessages: [],
          modelLoopRound: 0,
        });
      }),
    errorLogger: {
      async log() {
        callOrder.push("errorLogger.log");
      },
    },
    normalizeRunMessage: (message) => message,
    validateRunInput: () => {},

    initializeRunSessionRuntime: async ({ parentSessionId }) => ({
      usedSessionId: "session-used",
      parentSessionId,
      dialogProcessId: "dialog-1",
      sessionLoadState: "created",
      userConfig: {},
      currentSessionModelAlias: "",
      runtimeEventListener: { flush: async () => {}, ...eventListener },
    }),
    resolveScenarioRunConfig: (runConfig) => runConfig,
    prepareRunConfig: ({ runConfig: inputRunConfig }) => ({
      ...inputRunConfig,
      hookManager: null,
      botHookManager: null,
      ...runConfig,
    }),
    buildContextBuilder: () => ({ kind: "context-builder" }),
    prepareTurnInput: async ({ buildContextPayload }) => ({
      userMessageAttachments: buildContextPayload.userMessageAttachments,
    }),
    bindSessionTurnAttachments: async () => {
      throw new Error("attachment binding is not part of this fixture");
    },

    prepareAgentTurnExecution: async (payload) => {
      await observePreparedTurn?.(payload);
      const { runtimeIdentity, runConfig: acceptedRunConfig } = payload.buildContextPayload;
      const preparedRuntime =
        runtime || bindTestRuntime(createTestRuntimeContext({ identity: runtimeIdentity }));
      const agentContext = createTestAgentExecutionScope(preparedRuntime, {
        identity: projectAgentContextIdentity(
          { ...runtimeIdentity, rootSessionId: runtimeIdentity.sessionId },
          acceptedRunConfig,
        ),
      });
      return { agentContext, userMessageAttachments: [] };
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
    now: () => "2026-05-21T00:00:00.000Z",
  });
  runner.runAcceptedSession = (request) => {
    const turnScopeId = text(request.turnScopeId);
    const acceptedRunConfig = createAcceptedRunIdentity(turnScopeId, request.runConfig);
    const messageUid = `sm_test_${turnScopeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    acceptedUserMessages.set(turnScopeId, {
      messageUid,
      userMessageId: acceptedRunConfig.userMessageId,
      role: "user",
      type: "message",
      content: request.message,
      userName: request.userId,
      sessionId: "session-used",
      dialogProcessId: "dialog-1",
      turnScopeId,
      messageOrigin: "natural",
      attachments: [],
      ts: TEST_MESSAGE_TS,
    });
    return runner.runSession(
      createTestSessionRunPayload({
        ...request,
        turnScopeId,
        runConfig: acceptedRunConfig,
        turnAcceptance: createTurnAcceptanceReceipt({
          ...createTestSessionRequiredFields(),
          commandId: acceptedRunConfig.commandId,
          sessionId: "session-used",
          turnScopeId,
          dialogProcessId: "dialog-1",
          messageUid,
          aggregateVersion: 1,
        }),
      }),
    );
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
