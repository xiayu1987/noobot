/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { commitAuthoritativeFinalResult } from "../../../src/runtime/engine.js";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import {
  beginAssistantMessageEventStream,
  bindAssistantMessageEventStream,
  applyAuthoritativeMessageId,
} from "../../../src/events/message-event-stream.js";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";

test("authoritative message id can be applied to immutable model output", () => {
  const output = Object.freeze({
    text: "answer",
    additional_kwargs: Object.freeze({ provider: "openai" }),
  });
  const projected = applyAuthoritativeMessageId(output, "assistant-1");

  assert.equal(projected.id, "assistant-1");
  assert.equal(projected.messageId, "assistant-1");
  assert.equal(projected.additional_kwargs.provider, "openai");
  assert.equal(projected.additional_kwargs.noobotMessageId, "assistant-1");
  assert.equal(output.id, undefined);
});

test("authoritative final event owns generated attachment envelopes before persistence", async () => {
  const events = [];
  const runtime = {
    eventListener: { onEvent: (event = {}) => events.push(event) },
    sessionManager: createCanonicalMessageEventSessionManager(),
    userId: "user-1",
    runConfig: { commandId: "command-1", turnScopeId: "turn-1" },
    systemRuntime: {
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
    },
  };
  bindAssistantMessageEventStream(runtime, {
    messageId: "message-event-1",
    presentationMessageId: "presentation-1",
  });
  beginAssistantMessageEventStream(runtime);

  const transferEnvelope = {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: "transfer:message-event-1:tool:search-call:output:tool_result_text",
    messageId: "message-event-1",
    identity: {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      runId: "run-1",
      producer: { type: "tool", id: "search-call" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: {
            attachmentId: "search-attachment-1",
            sessionId: "session-1",
            attachmentSource: "model",
          },
          role: "primary",
          name: "search.result.txt",
          mimeType: "text/plain",
          size: 1301812,
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "tool_result_overflow",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: {
      attributes: {
        overflowContentKind: "tool_result",
        toolName: "search",
        toolCallId: "search-call",
      },
    },
  };
  runtime.currentTurnMessages = createCurrentTurnMessagesStore([
    {
      role: "tool",
      type: "tool_result",
      messageId: "tool-message-1",
      transferEnvelopes: [transferEnvelope],
    },
    {
      role: "assistant",
      type: "message",
      messageId: "assistant-message-1",
      presentationMessageId: "presentation-1",
      content: "draft",
    },
  ]);
  const result = {
    output: "final answer",
    assistantMessageId: "assistant-message-1",
    turnMessages: runtime.currentTurnMessages.toArray(),
  };
  runtime.currentTurnMessages.push({
    role: "system",
    type: "message",
    messageId: "final-hook-control-1",
    content: "final response policy",
    summarized: false,
  });

  assert.equal(await commitAuthoritativeFinalResult({ result, runtime }), true);

  const finalEnvelope = events.find((event) => event?.event === "authority_event_committed")?.data
    ?.envelope;
  assert.deepEqual(finalEnvelope?.payload?.transferEnvelopes, [transferEnvelope]);
  assert.deepEqual(
    runtime.currentTurnMessages
      .toArray()
      .find((message) => message.messageId === "assistant-message-1")?.transferEnvelopes,
    [transferEnvelope],
  );
  assert.deepEqual(
    result.turnMessages.find((message) => message.messageId === "assistant-message-1")
      ?.transferEnvelopes,
    [transferEnvelope],
  );
  assert.equal(
    result.turnMessages.find((message) => message.messageId === "final-hook-control-1")?.summarized,
    true,
  );
});

test("authoritative final completion retains classified checkpoint call-result pairs", async () => {
  const evidencePolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
  const boundaryPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);
  const toolCallMessage = (messageUid, callId, name, contextPolicy = null) => ({
    messageUid,
    id: `provider-${messageUid}`,
    messageId: `provider-${messageUid}`,
    role: "assistant",
    type: "tool_call",
    tool_calls: [
      {
        id: callId,
        name,
        args: {},
        ...(contextPolicy ? { contextPolicy } : {}),
      },
    ],
  });
  const toolResultMessage = (messageUid, callId, name) => ({
    messageUid,
    id: messageUid,
    messageId: messageUid,
    role: "tool",
    type: "tool_result",
    tool_call_id: callId,
    toolName: name,
    content: `${name} result`,
  });
  const runtime = {
    eventListener: { onEvent: () => {} },
    sessionManager: createCanonicalMessageEventSessionManager(),
    userId: "user-checkpoint",
    runConfig: { commandId: "command-checkpoint", turnScopeId: "turn-checkpoint" },
    systemRuntime: {
      sessionId: "session-checkpoint",
      dialogProcessId: "dialog-checkpoint",
      turnScopeId: "turn-checkpoint",
    },
  };
  bindAssistantMessageEventStream(runtime, {
    messageId: "final-message",
    presentationMessageId: "final-presentation",
  });
  beginAssistantMessageEventStream(runtime);
  runtime.currentTurnMessages = createCurrentTurnMessagesStore([
    toolCallMessage("ordinary-call-message", "ordinary-call", "execute_script"),
    toolResultMessage("ordinary-result-message", "ordinary-call", "execute_script"),
    toolCallMessage("evidence-call-message", "evidence-call", "task_check", evidencePolicy),
    toolResultMessage("evidence-result-message", "evidence-call", "task_check"),
    toolCallMessage("boundary-call-message", "boundary-call", "task_summary", boundaryPolicy),
    toolResultMessage("boundary-result-message", "boundary-call", "task_summary"),
    toolCallMessage("later-call-message", "later-call", "read_file"),
    toolResultMessage("later-result-message", "later-call", "read_file"),
    {
      messageUid: "final-message-uid",
      id: "final-message",
      messageId: "final-message",
      presentationMessageId: "final-presentation",
      role: "assistant",
      type: "message",
      content: "draft",
    },
  ]);
  const result = {
    output: "final answer",
    assistantMessageId: "final-message",
    modelMessages: [],
  };

  assert.equal(await commitAuthoritativeFinalResult({ result, runtime }), true);

  const messagesByUid = new Map(
    runtime.currentTurnMessages.toArray().map((message) => [message.messageUid, message]),
  );
  assert.equal(messagesByUid.get("ordinary-call-message")?.summarized, true);
  assert.equal(messagesByUid.get("ordinary-result-message")?.summarized, true);
  assert.equal(messagesByUid.get("evidence-call-message")?.summarized, undefined);
  assert.equal(messagesByUid.get("evidence-result-message")?.summarized, undefined);
  assert.equal(messagesByUid.get("boundary-call-message")?.summarized, undefined);
  assert.equal(messagesByUid.get("boundary-result-message")?.summarized, undefined);
  assert.equal(messagesByUid.get("later-call-message")?.summarized, true);
  assert.equal(messagesByUid.get("later-result-message")?.summarized, true);
});
