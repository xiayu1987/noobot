/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import os from "node:os";
import {
  executeToolCall as executeToolCallWithoutTurn,
  executeToolCallInTurn,
} from "../../../src/runtime/tool-execution/tool-runner.js";
import { bindAssistantMessageEventStream } from "../../../src/events/message-event-stream.js";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";

export function executeToolCall(options = {}) {
  const runtime = options.runtime && typeof options.runtime === "object" ? options.runtime : {};
  runtime.userId = String(runtime.userId || options.userId || "test-user");
  runtime.globalConfig =
    runtime.globalConfig && typeof runtime.globalConfig === "object" ? runtime.globalConfig : {};
  runtime.globalConfig.workspaceRoot = String(
    runtime.globalConfig.workspaceRoot || runtime.basePath || os.tmpdir(),
  );
  const systemRuntime =
    runtime.systemRuntime && typeof runtime.systemRuntime === "object"
      ? runtime.systemRuntime
      : (runtime.systemRuntime = {});
  const identity = String(options.identity || options.call?.id || "test-tool-call");
  systemRuntime.sessionId = String(systemRuntime.sessionId || "test-session");
  systemRuntime.dialogProcessId = String(systemRuntime.dialogProcessId || "test-dialog");
  systemRuntime.turnScopeId = String(systemRuntime.turnScopeId || "test-turn");
  systemRuntime.executionId = String(
    systemRuntime.executionId || `agent:${systemRuntime.turnScopeId}`,
  );
  runtime.runConfig =
    runtime.runConfig && typeof runtime.runConfig === "object" ? runtime.runConfig : {};
  runtime.runConfig.turnScopeId = String(
    runtime.runConfig.turnScopeId || systemRuntime.turnScopeId,
  );
  runtime.runConfig.executionId = String(
    runtime.runConfig.executionId || systemRuntime.executionId,
  );
  runtime.runConfig.sessionId = String(runtime.runConfig.sessionId || systemRuntime.sessionId);
  systemRuntime.messageEventStream =
    systemRuntime.messageEventStream && typeof systemRuntime.messageEventStream === "object"
      ? systemRuntime.messageEventStream
      : { sequence: 0 };
  if (!systemRuntime.messageEventStream.activeMessageId) {
    bindAssistantMessageEventStream(runtime, {
      messageId: String(options.messageId || `message-${identity}`),
      presentationMessageId: String(options.presentationMessageId || `presentation-${identity}`),
    });
  }
  if (options.eventListener && !runtime.sessionManager) {
    runtime.sessionManager = createCanonicalMessageEventSessionManager();
  }
  return options.eventListener
    ? executeToolCallInTurn({ ...options, runtime })
    : executeToolCallWithoutTurn({ ...options, runtime });
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
  messageId = `message-${callId}`,
  name = "result.txt",
  mimeType = "text/plain",
  size = 0,
} = {}) {
  return {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: `transfer:${messageId}:tool:${callId}:output:tool_result_text:structured`,
    messageId,
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
