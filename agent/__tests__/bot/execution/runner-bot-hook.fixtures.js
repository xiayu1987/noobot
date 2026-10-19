/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";

import { SessionExecutionRunner } from "../../../src/bot/execution/runner.js";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { createAgentCapabilityModelInvoker } from "../../../src/runtime/capability-runner/index.js";
import { createBotDispatchHandled } from "@noobot/agent-transport-protocol/bot-dispatch";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import { text, isFunction, isObjectLike } from "@noobot/shared/value";
import { createTurnAcceptanceReceipt } from "@noobot/session-protocol";
import { createAcceptedRunIdentity } from "../../helpers/accepted-run-identity.js";
import { createTestSessionRequiredFields } from "../../helpers/session-message-facts.js";

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

function canonicalMessageIdForTest(message = {}, activeAssistantMessageId = "") {
  if (message?.role === "assistant" && activeAssistantMessageId) return activeAssistantMessageId;
  const existing = String(message?.messageId || message?.id || "").trim();
  if (existing) return existing;
  const stableLocalId = String(message?.messageUid || message?.tool_call_id || "").trim();
  if (!stableLocalId) throw new Error("test Turn message requires a stable identity");
  return `msg_event_test_${stableLocalId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function createCanonicalHandledResult(context = {}, output = "") {
  const messageId = text(context?.runConfig?.messageId);
  if (!messageId) throw new Error("handled test result requires the bound canonical messageId");
  return {
    output,
    traces: [],
    assistantMessageId: messageId,
    turnMessages: [{ role: "assistant", type: "message", messageId, content: output }],
    turnTasks: [],
  };
}

export function persistedUserMessage({
  userId,
  sessionId,
  parentSessionId = "",
  turnScopeId,
  dialogProcessId,
  attachments = [],
} = {}) {
  const turnIdentity = text(turnScopeId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return {
    messageUid: `sm_test_${turnIdentity}`,
    messageId: `msg_user_test_${turnIdentity}`,
    role: "user",
    type: "message",
    content: "persisted",
    userName: userId,
    sessionId,
    parentSessionId,
    dialogProcessId,
    turnScopeId,
    messageOrigin: "natural",
    userMetaMaterialized: true,
    attachments,
  };
}

export function createRunner({
  botHookManager = createTestBotHookManager(),
  agentRunner = async () => ({
    output: "ok",
    traces: [],
    turnMessages: [],
    turnTasks: [],
  }),
  prepareAgentTurnExecution = async () => ({
    agentContext: createTestAgentExecutionScope(createTestRuntimeContext()),
    userMessageAttachments: [],
  }),
  initializeRunSessionRuntime = async ({ eventListener = null } = {}) => ({
    usedSessionId: "s1",
    dialogProcessId: "dp1",
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
  assertReusedUserTurnIdentity = async () => ({}),
  assertPersistenceContextIdentity = () => {},
  finalizeRunSession = async () => ({ answer: "ok" }),
  saveExecutionReport = async () => {},
  getExecutionTurnLogs = async () => [],
  upsertParentAsyncTask = () => {},
} = {}) {
  let authorityEventSequence = 0;
  const acceptedUserMessages = new Map();
  const acceptRequest = (request = {}, identity = {}) => {
    const turnScopeId = text(request.turnScopeId);
    const runConfig = createAcceptedRunIdentity(turnScopeId, request.runConfig);
    const sessionId = text(identity.sessionId) || "s1";
    const dialogProcessId = text(identity.dialogProcessId) || "dp1";
    const turnIdentity = turnScopeId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const userMessage = {
      messageUid: `sm_test_${turnIdentity}`,
      messageId: runConfig.userMessageId,
      role: "user",
      type: "message",
      content: request.message,
      userName: request.userId,
      sessionId,
      parentSessionId: request.parentSessionId || "",
      dialogProcessId,
      turnScopeId,
      messageOrigin: "natural",
      userMetaMaterialized: true,
      attachments: [],
    };
    acceptedUserMessages.set(turnScopeId, userMessage);
    return {
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
        committedEventPublished: identity.committedEventPublished === true,
      }),
    };
  };
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
      ...(initialized || {}),
      sessionManager: initialized?.sessionManager || sessionManager,
      runtimeEventListener: {
        flush: async () => {},
        ...(initialized?.runtimeEventListener || payload?.eventListener || NOOP_EVENT_LISTENER),
      },
    };
  };
  const prepareCanonicalAgentTurnExecution = async (payload = {}) => {
    const prepared = await prepareAgentTurnExecution(payload);
    const runtime = prepared.agentContext.bindings.runtime;
    if (isObjectLike(runtime)) {
      runtime.sessionManager = runtime.sessionManager || sessionManager;
      const currentStore = runtime.currentTurnMessages;
      const isCanonicalStore =
        isFunction(currentStore?.push) &&
        isFunction(currentStore?.updateLast) &&
        isFunction(currentStore?.removeLast) &&
        isFunction(currentStore?.updateWhere) &&
        isFunction(currentStore?.toArray);
      if (!isCanonicalStore) {
        runtime.currentTurnMessages = createCurrentTurnMessagesStore(
          typeof currentStore?.toArray === "function" ? currentStore.toArray() : [],
        );
      }
    }
    return prepared;
  };
  const runCanonicalAgent = async (payload = {}) => {
    const result = await agentRunner(payload);
    if (!isObjectLike(result) || !String(result.output || "")) return result;
    const runtime = payload?.agentContext?.bindings?.runtime;
    const messageId = text(runtime?.systemRuntime?.messageEventStream?.activeMessageId);
    if (!messageId) throw new Error("test Agent result requires the bound canonical messageId");
    const store = runtime.currentTurnMessages;
    for (const [index, message] of store.toArray().entries()) {
      const canonicalMessageId = canonicalMessageIdForTest(message, messageId);
      store.updateWhere(
        { messageId: canonicalMessageId },
        (_current, currentIndex) => currentIndex === index,
      );
    }
    for (const message of Array.isArray(result.turnMessages) ? result.turnMessages : []) {
      const canonicalMessageId = canonicalMessageIdForTest(message, messageId);
      const canonicalMessage = { ...message, messageId: canonicalMessageId };
      const updatedCount = store.updateWhere(
        canonicalMessage,
        (current) => text(current?.messageId) === canonicalMessageId,
      );
      if (updatedCount === 0) store.push(canonicalMessage);
    }
    const messages = store.toArray();
    const assistantIndex = [...messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message?.role === "assistant")?.index;
    if (assistantIndex === undefined) {
      store.push({ role: "assistant", type: "message", messageId, content: String(result.output) });
    } else {
      store.updateWhere({ messageId }, (_message, index) => index === assistantIndex);
    }
    return {
      ...result,
      assistantMessageId: String(result.assistantMessageId || messageId).trim(),
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
  const assertCanonicalReusedUserMessage = async (payload = {}) => {
    const result = (await assertReusedUserTurnIdentity(payload)) || {};
    const accepted = acceptedUserMessages.get(text(payload.turnScopeId));
    return { ...result, userMessage: result.userMessage || accepted };
  };
  const runner = new SessionExecutionRunner({
    agentRunner: runCanonicalAgent,
    errorLogger: { async log() {} },
    normalizeRunMessage: (message = "") => text(message),
    validateRunInput() {},
    ensureParentAsyncResultContainer: ({ parentAsyncResultContainer = null } = {}) =>
      parentAsyncResultContainer,
    initializeRunSessionRuntime: initializeCanonicalRunSessionRuntime,
    resolveScenarioRunConfig,
    prepareRunConfig,
    buildContextBuilder: () => ({ kind: "context-builder" }),
    prepareTurnInput,
    prepareAgentTurnExecution: prepareCanonicalAgentTurnExecution,
    appendAgentMessages,
    getSessionTurns,
    getTurnSummaryCheckpointState: async () => null,
    assertPersistenceContextIdentity,
    bindSessionTurnAttachments: bindCanonicalUserMessageAttachments,
    assertReusedUserTurnIdentity: assertCanonicalReusedUserMessage,
    finalizeRunSession,
    saveExecutionReport,
    getExecutionTurnLogs,
    upsertParentAsyncTask,
    now: () => new Date().toISOString(),
  });
  runner.runAcceptedSession = (request = {}, identity = {}) =>
    runner.runSession(acceptRequest(request, identity));
  return runner;
}

export {
  HOOK_POINT,
  createAgentCapabilityModelInvoker,
  createBotDispatchHandled,
  createTestAgentExecutionScope,
  createCurrentTurnMessagesStore,
};
