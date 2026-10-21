/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import {
  executeToolCall as executeToolCallWithoutTurn,
  executeToolCallInTurn,
} from "../../../src/runtime/tool-execution/tool-runner.js";
import { bindAssistantMessageEventStream } from "../../../src/events/message-event-stream.js";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import {
  applyTestIdentityToRuntime,
  createTestTurnIdentity,
} from "../../helpers/test-turn-identity.js";

export function executeToolCall({
  call,
  runtime = createTestRuntimeContext(),
  identity = createTestTurnIdentity(call.id),
  ...options
}) {
  applyTestIdentityToRuntime(runtime, identity);
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId: identity.presentationMessageId,
    parentSessionId: identity.parentSessionId,
  });
  if (runtime.eventListener && !runtime.sessionManager) {
    runtime.sessionManager = createCanonicalMessageEventSessionManager();
  }
  const agentContext = createTestAgentExecutionScope(runtime, { identity });
  const execution = { abortSignal: runtime.abortSignal, ...options, call, runtime, agentContext };
  return runtime.eventListener
    ? executeToolCallInTurn(execution)
    : executeToolCallWithoutTurn(execution);
}

export function getPrimaryTransferAttachment(envelope = {}) {
  return Array.isArray(envelope?.payload?.attachments) ? envelope.payload.attachments[0] || {} : {};
}

export function findTransferEnvelopeByReason(envelopes = [], reason = "") {
  return (Array.isArray(envelopes) ? envelopes : []).find(
    (item = {}) => item?.intent?.reason === reason,
  );
}

export function findCommittedMessagePayload(events = [], eventType = "") {
  return (Array.isArray(events) ? events : []).find(
    (event = {}) =>
      event?.event === "authority_event_committed" &&
      event?.data?.envelope?.payload?.eventType === eventType,
  )?.data?.envelope?.payload;
}

export function attachmentEnvelope({
  callId,
  attachmentId,
  sessionId = "test-session",
  presentationMessageId = `presentation-${callId}`,
  name = "result.txt",
  mimeType = "text/plain",
  size = 0,
} = {}) {
  return {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: `transfer:${presentationMessageId}:tool:${callId}:output:tool_result_text:structured`,
    presentationMessageId,
    identity: {
      sessionId,
      turnScopeId: "test-turn",
      runId: "agent:test-turn",
      producer: { type: "tool", id: callId },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: { attachmentId, sessionId, attachmentSource: "model" },
          role: "primary",
          name,
          mimeType,
          size,
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "semantic_transfer_tool_result",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: { persisted: true },
  };
}
