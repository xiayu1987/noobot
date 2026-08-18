/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionExecutionRunner } from "../../src/bot/execution/runner.js";
import { finalizeAgentTurn } from "../../src/bot/execution/runner/result-finalizer.js";
import { createCurrentTurnMessagesStore } from "../../src/runtime/turn/current-turn-ledger.js";
import {
  AGENT_LIFECYCLE_BRANCH_STATE,
  AGENT_LIFECYCLE_EVENT,
  AGENT_LIFECYCLE_STATE,
} from "../../src/runtime/lifecycle/state-machine.js";
import { loadStoppedModelMessageSnapshot } from "../../src/runtime/resume/model-message-snapshot-store.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import {
  createEventEnvelope,
  EVENT_FAMILY,
} from "@noobot/event-protocol";
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
  getSessionTurns,
  getTurnSummaryCheckpointState,
}) {
  const defaultRuntime = runtime || { attachmentMetas: [] };
  let authorityEventSequence = 0;
  const sessionManager = {
    async commitMessageEvent({ sessionId, turnScopeId, messageId, commandId, correlationId, payload }) {
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
  return new SessionExecutionRunner({
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
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig) => runConfig,
    prepareRunConfig: ({ runConfig: inputRunConfig }) => ({
      turnScopeId: inputRunConfig?.turnScopeId || runConfig?.turnScopeId || "turn-default",
      ...inputRunConfig,
      ...runConfig,
    }),
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
      if (preparedRuntime && typeof preparedRuntime === "object") {
        preparedRuntime.sessionManager = preparedRuntime.sessionManager || sessionManager;
      }
      return prepared;
    },
    commitSessionTurn: async (payload = {}) => {
      callOrder.push("appendSessionTurn");
      const messageUid = `sm_test_${String(payload.turnScopeId || "turn").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      return {
        aggregateVersion: 1,
        attachments: payload.attachments || [],
        userMessage: {
          messageUid,
          id: payload.messageId || messageUid,
          messageId: payload.messageId || messageUid,
          role: "user",
          type: "message",
          content: payload.content,
          userName: payload.userId,
          sessionId: payload.sessionId,
          parentSessionId: payload.parentSessionId,
          dialogProcessId: payload.dialogProcessId,
          parentDialogProcessId: payload.parentDialogProcessId,
          turnScopeId: payload.turnScopeId,
          frontendUserMessage: payload.frontendUserMessage === true,
          messageOrigin: payload.frontendUserMessage === true ? "user" : "internal",
          attachments: payload.attachments || [],
        },
      };
    },
    getSessionTurns,
    getTurnSummaryCheckpointState,
    finalizeRunSession,
    upsertParentAsyncTask: () => {
      callOrder.push("upsertParentAsyncTask");
    },
    now: () => "2026-05-21T00:00:00.000Z",
  });
}

export function collectLifecycleStates(events) {
  return events
    .filter((item) => item.event === AGENT_LIFECYCLE_EVENT)
    .map((item) => item.data.state);
}

export function findStoppedLifecycleEvent(events) {
  return events.find(
    (item) =>
      item.event === AGENT_LIFECYCLE_EVENT &&
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
  AGENT_LIFECYCLE_EVENT,
  AGENT_LIFECYCLE_STATE,
  loadStoppedModelMessageSnapshot,
  createCurrentTurnMessagesStore,
  createTestAgentExecutionScope,
};
