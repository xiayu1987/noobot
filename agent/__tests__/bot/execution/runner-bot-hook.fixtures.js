/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEmptyTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import { createMessageUid, createModelMessageId } from "@noobot/session-protocol/message-identity";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";

import { SessionExecutionRunner } from "../../../src/bot/execution/runner.js";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { createAgentCapabilityModelInvoker } from "../../../src/runtime/capability-runner/index.js";
import { createBotDispatchHandled } from "@noobot/agent-transport-protocol/bot-dispatch";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import { text, isObjectLike } from "@noobot/shared/value";
import { createTurnAcceptanceReceipt } from "@noobot/session-protocol";
import { createAcceptedRunIdentity } from "../../helpers/accepted-run-identity.js";
import { createTestSessionRequiredFields } from "../../helpers/session-message-facts.js";
import {
  TEST_ACCEPTED_DIALOG_PROCESS_ID,
  TEST_MESSAGE_TS,
  createTestSessionRunPayload,
} from "../../helpers/session-run-payload.js";
import { createAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";

const DEFAULT_ACCEPTED_RECEIPT = Object.freeze({
  dialogProcessId: TEST_ACCEPTED_DIALOG_PROCESS_ID,
  committedEventPublished: false,
});

export const NOOP_EVENT_LISTENER = Object.freeze({ onEvent() {} });

export function createTestBotHookManager() {
  const manager = createHookManager();
  let handlerSequence = 0;
  return Object.freeze({
    ...manager,
    on(point, handler, options = {}) {
      handlerSequence += 1;
      return manager.on(point, handler, {
        ...options,
        id: options.id || `test.bot-handler.${handlerSequence}`,
      });
    },
  });
}

function withModelMessageIdForTest(message = {}, modelMessageId = "") {
  return message?.role === "assistant" ? { ...message, modelMessageId } : message;
}

export function createCanonicalHandledResult(output = "") {
  const messageId = createModelMessageId();
  return createAgentTurnResult({
    output,
    traces: [],
    modelMessageId: messageId,
    turnMessages: [
      {
        role: "assistant",
        type: "message",
        messageUid: createMessageUid(),
        modelMessageId: messageId,
        content: output,
      },
    ],
    turnTasks: [],
    modelMessages: [],
    modelLoopRound: 0,
  });
}

export function persistedUserMessage({
  userId,
  sessionId,
  turnScopeId,
  dialogProcessId,
  attachments = [],
} = {}) {
  const turnIdentity = text(turnScopeId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return {
    messageUid: `sm_test_${turnIdentity}`,
    userMessageId: `um_test_${turnIdentity}`,
    role: "user",
    type: "message",
    content: "persisted",
    userName: userId,
    sessionId,
    parentSessionId: "",
    dialogProcessId,
    turnScopeId,
    messageOrigin: "natural",
    attachments,
    ts: TEST_MESSAGE_TS,
  };
}

export function createRunner({
  botHookManager = createTestBotHookManager(),
  agentRunner = async () => createCanonicalHandledResult("ok"),
  prepareAgentTurnExecution = async () => ({
    agentContext: createTestAgentExecutionScope(createTestRuntimeContext()),
    userMessageAttachments: [],
  }),

  initializeRunSessionRuntime = async ({ eventListener = null, parentSessionId } = {}) => ({
    usedSessionId: "s1",
    parentSessionId,
    dialogProcessId: TEST_ACCEPTED_DIALOG_PROCESS_ID,
    sessionLoadState: "created",
    userConfig: {},
    currentSessionModelAlias: "",
    runtimeEventListener: eventListener || NOOP_EVENT_LISTENER,
  }),
  resolveScenarioRunConfig = (runConfig = {}) => runConfig,
  prepareRunConfig = (payload = {}) => ({
    ...(payload?.runConfig || {}),
    botHookManager,
  }),
  prepareTurnInput = async ({ buildContextPayload }) => ({
    userMessageAttachments: buildContextPayload.userMessageAttachments,
  }),
  appendAgentMessages = async () => [],
  getSessionTurns = async () => [],
  bindSessionTurnAttachments = async () => ({}),
  assertReusedUserTurnIdentity = null,
  finalizeRunSession = async () => ({ answer: "ok" }),
  saveExecutionReport = async () => {},
  getExecutionTurnLogs = async () => [],
} = {}) {
  let authorityEventSequence = 0;
  const acceptedUserMessages = new Map();
  const acceptRequest = (request, receipt = DEFAULT_ACCEPTED_RECEIPT) => {
    const turnScopeId = text(request.turnScopeId);
    const runConfig = createAcceptedRunIdentity(turnScopeId, request.runConfig);
    const { sessionId } = request;
    const { dialogProcessId } = receipt;
    const turnIdentity = turnScopeId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const userMessage = {
      messageUid: `sm_test_${turnIdentity}`,
      userMessageId: runConfig.userMessageId,
      role: "user",
      type: "message",
      content: request.message,
      userName: request.userId,
      sessionId,
      parentSessionId: request.parentSessionId,
      dialogProcessId,
      turnScopeId,
      messageOrigin: "natural",
      attachments: [],
      ts: TEST_MESSAGE_TS,
    };
    acceptedUserMessages.set(turnScopeId, userMessage);
    return createTestSessionRunPayload({
      ...request,
      turnScopeId,
      runConfig,
      turnAcceptance: createTurnAcceptanceReceipt({
        ...createTestSessionRequiredFields(),
        commandId: runConfig.commandId,
        sessionId,
        turnScopeId,
        dialogProcessId,
        messageUid: userMessage.messageUid,
        aggregateVersion: 1,
        committedEventPublished: receipt.committedEventPublished === true,
      }),
    });
  };
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
          producer: { type: "test", id: "runner-bot-hook-fixture" },
          occurredAt: new Date().toISOString(),
          payload,
        }),
      };
    },
  };
  const initializeCanonicalRunSessionRuntime = async (payload = {}) => {
    const initialized = await initializeRunSessionRuntime(payload);
    return {
      ...initialized,
      runtimeEventListener: {
        flush: async () => {},
        ...(initialized?.runtimeEventListener || payload?.eventListener || NOOP_EVENT_LISTENER),
      },
    };
  };
  const prepareCanonicalAgentTurnExecution = async (payload = {}) => {
    const prepared = await prepareAgentTurnExecution(payload);

    prepared.agentContext.bindings.runtime.sessionManager = sessionManager;
    return prepared;
  };
  const runCanonicalAgent = async (payload = {}) => {
    const result = await agentRunner(payload);
    if (!isObjectLike(result) || !String(result.output || "")) return result;
    const runtime = payload?.agentContext?.bindings?.runtime;

    const messageId = text(result.modelMessageId);
    if (!messageId) throw new Error("agent result with output requires modelMessageId");
    const store = runtime.currentTurnMessages;
    store.updateWhere({ modelMessageId: messageId }, (current) => current?.role === "assistant");
    for (const message of Array.isArray(result.turnMessages) ? result.turnMessages : []) {
      const messageUid = text(message?.messageUid);
      if (!messageUid) throw new Error("test Turn message requires messageUid");
      const canonicalMessage = withModelMessageIdForTest(message, messageId);
      const updatedCount = store.updateWhere(
        canonicalMessage,
        (current) => text(current?.messageUid) === messageUid,
      );
      if (updatedCount === 0) store.push(canonicalMessage);
    }
    const messages = store.toArray();
    const assistantIndex = [...messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message?.role === "assistant")?.index;
    if (assistantIndex === undefined) {
      store.push({
        role: "assistant",
        type: "message",
        messageUid: createMessageUid(),
        modelMessageId: messageId,
        content: String(result.output),
      });
    } else {
      store.updateWhere(
        { modelMessageId: messageId },
        (_message, index) => index === assistantIndex,
      );
    }
    return {
      ...result,
      modelMessageId: messageId,
      turnMessages: store.toArray(),
    };
  };
  const bindCanonicalUserMessageAttachments = async (payload = {}) => {
    const result = (await bindSessionTurnAttachments(payload)) || {};
    const committed = acceptedUserMessages.get(text(payload.turnScopeId)) || {};
    const userMessage = {
      ...committed,
      ...(result.userMessage || {}),
      attachments: result.attachments || payload.attachments || [],
    };
    acceptedUserMessages.set(text(payload.turnScopeId), userMessage);
    return {
      ...result,
      aggregateVersion: result.aggregateVersion ?? 2,
      attachments: userMessage.attachments,
      userMessage,
    };
  };

  const assertCanonicalReusedUserMessage =
    assertReusedUserTurnIdentity ??
    (async (payload) => ({ userMessage: acceptedUserMessages.get(payload.turnScopeId) }));
  const runner = new SessionExecutionRunner({
    agentRunner: runCanonicalAgent,
    errorLogger: { async log() {} },
    normalizeRunMessage: (message = "") => text(message),
    validateRunInput() {},
    initializeRunSessionRuntime: initializeCanonicalRunSessionRuntime,
    resolveScenarioRunConfig,
    prepareRunConfig,
    buildContextBuilder: () => ({ kind: "context-builder" }),
    prepareTurnInput,
    prepareAgentTurnExecution: prepareCanonicalAgentTurnExecution,
    appendAgentMessages,
    getSessionTurns,
    getTurnSummaryCheckpointState: async ({ dialogProcessId, turnScopeId }) =>
      createEmptyTurnSummaryCheckpointState({ dialogProcessId, turnScopeId }),
    bindSessionTurnAttachments: bindCanonicalUserMessageAttachments,
    assertReusedUserTurnIdentity: assertCanonicalReusedUserMessage,
    finalizeRunSession,
    saveExecutionReport,
    getExecutionTurnLogs,
    now: () => new Date().toISOString(),
  });
  runner.runAcceptedSession = (request, receipt) =>
    runner.runSession(acceptRequest(request, receipt));
  return runner;
}

export {
  HOOK_POINT,
  createAgentCapabilityModelInvoker,
  createBotDispatchHandled,
  createTestAgentExecutionScope,
  createCurrentTurnMessagesStore,
};
