/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";

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
  const messageId = String(context?.runConfig?.messageId || "").trim();
  if (!messageId) throw new Error("handled test result requires the bound canonical messageId");
  return {
    output,
    traces: [],
    assistantMessageId: messageId,
    turnMessages: [{ role: "assistant", type: "message", messageId, content: output }],
    turnTasks: [],
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
    agentContext: createTestAgentExecutionScope({ attachmentMetas: [] }),
    runtimeAgentContext: createTestAgentExecutionScope({ attachmentMetas: [] }),
  }),
  initializeRunSessionRuntime = async ({ eventListener = null } = {}) => ({
    usedSessionId: "s1",
    dialogProcessId: "dp1",
    sessionLoadState: "created",
    userConfig: {},
    currentSessionModelAlias: "",
    executionStartIndex: 0,
    runtimeEventListener: eventListener || NOOP_EVENT_LISTENER,
  }),
  resolveScenarioRunConfig = (runConfig = {}) => runConfig,
  prepareRunConfig = (payload = {}) => ({
    ...(payload?.runConfig || {}),
    turnScopeId: payload?.runConfig?.turnScopeId || "turn-default",
    botHookManager,
  }),
  prepareTurnInput = null,
  appendAgentMessages = async () => {},
  getSessionTurns = null,
  commitSessionTurn = async () => ({}),
  bindSessionTurnAttachments = async () => ({}),
  assertReusedUserTurnIdentity = async () => ({}),
  assertPersistenceContextIdentity = null,
} = {}) {
  let authorityEventSequence = 0;
  const committedUserMessages = new Map();
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
      runtimeEventListener:
        initialized?.runtimeEventListener || payload?.eventListener || NOOP_EVENT_LISTENER,
    };
  };
  const prepareCanonicalAgentTurnExecution = async (payload = {}) => {
    const prepared = await prepareAgentTurnExecution(payload);
    const runtime = prepared?.runtimeAgentContext?.bindings?.runtime;
    if (runtime && typeof runtime === "object") {
      runtime.sessionManager = runtime.sessionManager || sessionManager;
      const currentStore = runtime.currentTurnMessages;
      const isCanonicalStore =
        typeof currentStore?.push === "function" &&
        typeof currentStore?.updateLast === "function" &&
        typeof currentStore?.removeLast === "function" &&
        typeof currentStore?.updateWhere === "function" &&
        typeof currentStore?.toArray === "function";
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
    if (!result || typeof result !== "object" || !String(result.output || "")) return result;
    const runtime = payload?.agentContext?.bindings?.runtime;
    const messageId = String(
      runtime?.systemRuntime?.messageEventStream?.activeMessageId || "",
    ).trim();
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
        (current) => String(current?.messageId || "").trim() === canonicalMessageId,
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
  const commitCanonicalUserMessage = async (payload = {}) => {
    const result = (await commitSessionTurn(payload)) || {};
    const turnIdentity = String(payload.turnScopeId || "turn").replace(/[^a-zA-Z0-9_-]/g, "_");
    const sourceUserMessage = result.userMessage || {};
    const messageUid = String(sourceUserMessage.messageUid || `sm_test_${turnIdentity}`).trim();
    const messageId = String(
      sourceUserMessage.messageId ||
        sourceUserMessage.id ||
        payload?.runConfig?.userMessageId ||
        `msg_user_test_${turnIdentity}`,
    ).trim();
    const userMessage = {
      ...sourceUserMessage,
      messageUid,
      messageId,
      role: "user",
      type: "message",
      content: sourceUserMessage.content ?? payload.content,
      userName: sourceUserMessage.userName ?? payload.userId,
      sessionId: payload.sessionId,
      parentSessionId: payload.parentSessionId,
      dialogProcessId: payload.dialogProcessId,
      parentDialogProcessId: payload.parentDialogProcessId,
      turnScopeId: payload.turnScopeId,
      frontendUserMessage:
        sourceUserMessage.frontendUserMessage ?? payload.frontendUserMessage === true,
      messageOrigin:
        sourceUserMessage.messageOrigin ||
        (payload.frontendUserMessage === true ? "user" : "internal"),
      attachments: [],
    };
    committedUserMessages.set(messageUid, userMessage);
    return {
      ...result,
      sessionId: payload.sessionId,
      aggregateVersion: result.aggregateVersion ?? 1,
      attachments: [],
      userMessage,
    };
  };
  const bindCanonicalUserMessageAttachments = async (payload = {}) => {
    const result = (await bindSessionTurnAttachments(payload)) || {};
    const committed = committedUserMessages.get(payload.messageUid) || {};
    const userMessage = {
      ...committed,
      ...(result.userMessage || {}),
      attachments: result.attachments || payload.attachments || [],
    };
    committedUserMessages.set(payload.messageUid, userMessage);
    return {
      ...result,
      aggregateVersion: result.aggregateVersion ?? 2,
      attachments: userMessage.attachments,
      userMessage,
    };
  };
  const assertCanonicalReusedUserMessage = async (payload = {}) => {
    const result = (await assertReusedUserTurnIdentity(payload)) || {};
    return {
      ...result,
      userMessage: result.userMessage || {
        messageUid: `sm_test_${String(payload.turnScopeId || "turn").replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        messageId: `msg_user_test_${String(payload.turnScopeId || "turn").replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        role: "user",
        type: "message",
        content: "edited",
        userName: payload.userId,
        sessionId: payload.sessionId,
        parentSessionId: payload.parentSessionId,
        dialogProcessId: payload.dialogProcessId,
        turnScopeId: payload.turnScopeId,
        frontendUserMessage: true,
        messageOrigin: "user",
        attachments: payload.attachments || [],
      },
    };
  };
  return new SessionExecutionRunner({
    agentRunner: runCanonicalAgent,
    errorLogger: { async log() {} },
    normalizeRunMessage: (message = "") => String(message || "").trim(),
    validateRunInput() {},
    ensureParentAsyncResultContainer: ({ parentAsyncResultContainer = null } = {}) =>
      parentAsyncResultContainer,
    initializeRunSessionRuntime: initializeCanonicalRunSessionRuntime,
    resolveScenarioRunConfig,
    prepareRunConfig,
    prepareTurnInput,
    prepareAgentTurnExecution: prepareCanonicalAgentTurnExecution,
    appendAgentMessages,
    getSessionTurns,
    appendSessionTurn: async () => {},
    assertPersistenceContextIdentity,
    commitSessionTurn: commitCanonicalUserMessage,
    bindSessionTurnAttachments: bindCanonicalUserMessageAttachments,
    assertReusedUserTurnIdentity: assertCanonicalReusedUserMessage,
    finalizeRunSession: async () => ({ answer: "ok" }),
    upsertParentAsyncTask: () => {},
    now: () => new Date().toISOString(),
  });
}

export {
  HOOK_POINT,
  createAgentCapabilityModelInvoker,
  createBotDispatchHandled,
  createTestAgentExecutionScope,
  createCurrentTurnMessagesStore,
};
