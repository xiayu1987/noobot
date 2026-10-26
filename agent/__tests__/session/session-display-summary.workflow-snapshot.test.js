/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKFLOW_RUNTIME_EVENT,
  createWorkflowRuntimeEnvelope,
} from "@noobot/event-protocol/workflow-runtime-event";
import { TURN_RECOVERY_ACTION, createTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";

test("display summary messages are admissible as workflow session snapshot messages", () => {
  const summary = buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "child-session",
    aggregateVersion: 3,
    messages: [
      {
        sessionId: "child-session",
        messageUid: "sm_user",
        userMessageId: "um_1",
        dialogProcessId: "dp-1",
        role: "user",
        type: "message",
        content: "hi",
        turnScopeId: "turn-1",
      },
      {
        sessionId: "child-session",
        messageUid: "sm_ai",
        modelMessageId: "mm_1",
        presentationMessageId: "pm_1",
        dialogProcessId: "dp-1",
        role: "assistant",
        type: "message",
        content: "done",
        chatPresentation: true,
        turnScopeId: "turn-1",
      },
    ],
  });

  assert.equal(summary.messages.length, 2);
  for (const message of summary.messages) assert.equal(Object.hasOwn(message, "sessionId"), false);
  const envelope = createWorkflowRuntimeEnvelope({
    eventType: WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    authoritySessionId: "root-session",
    turnScopeId: "workflow-node:node-1",
    executionId: "agent:node-1",
    eventId: "workflow-session-snapshot:child-session:3",
    workflowRunId: "run-1",
    causality: { correlationId: "run-1" },
    sequence: 3,
    aggregateVersion: 3,
    occurredAt: "2026-08-19T00:00:00.000Z",
    producer: { type: "service", id: "workflow-session-read-model" },
    payload: {
      workflowRunId: "run-1",
      nodeExecutionId: "node-1",
      nodeSessionId: "child-session",
      turnScopeId: "workflow-node:node-1",
      messages: summary.messages,
      turnLifecycleSnapshot: createTurnLifecycleSnapshot({
        commandId: "snapshot:child-session:3",
        sessionId: "child-session",
        sequence: 3,
        activeTurnScopeId: "",
        activeTurn: null,
        recentTerminalTurns: [],
        replacedTurns: [],
        unchanged: false,
        recovery: TURN_RECOVERY_ACTION.NONE,
        generatedAt: "2026-08-19T00:00:00.000Z",
      }),
      turnTimings: [],
    },
  });
  assert.equal(envelope.payload.messages.length, 2);
});

function buildWorkflowSummary(payload) {
  return buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "root-session",
    aggregateVersion: 1,
    messages: [
      {
        sessionId: "root-session",
        messageUid: "sm_workflow",
        presentationMessageId: "pm_workflow",
        dialogProcessId: "dp-1",
        role: "assistant",
        type: "message",
        content: "workflow",
        chatPresentation: true,
        turnScopeId: "turn-1",
        pluginMeta: { pluginId: "workflow", payload },
      },
    ],
  });
}

test("display summary passes plugin payload through unchanged", () => {
  const failure = { source: "workflow", code: "WORKFLOW_NODE_EXECUTION_FAILED", message: "boom" };
  const payload = {
    workflowRunId: "run-1",
    runMeta: { sessionId: "root-session", dialogProcessId: "dp-1" },
    semantic: { nodes: [], flowtos: [] },
    nodeSessions: [{ nodeId: "node-1", nodeSessionId: "child-1", status: "failed", failure }],
    interaction: { semanticTextPreview: "preview" },
  };
  const summary = buildWorkflowSummary(payload);

  assert.deepEqual(summary.messages[0].pluginMeta.payload, payload);
});

test("display summary rejects transfer envelopes inside plugin payload", () => {
  assert.throws(
    () =>
      buildWorkflowSummary({
        workflowRunId: "run-1",
        nodeSessions: [{ nodeId: "node-1", transferEnvelopes: [] }],
      }),
    { code: "PLUGIN_MESSAGE_PAYLOAD_INVALID" },
  );
});
