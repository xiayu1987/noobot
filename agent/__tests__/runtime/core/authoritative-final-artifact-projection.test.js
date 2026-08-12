/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { commitAuthoritativeFinalResult } from "../../../src/runtime/engine.js";
import { createCurrentTurnMessagesStore } from "../../../src/context/session/current-turn-store.js";
import {
  beginAssistantMessageEventStream,
  bindAssistantMessageEventStream,
  applyAuthoritativeMessageId,
} from "../../../src/events/message-event-stream.js";

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

test("authoritative final event owns generated attachment envelopes before persistence", () => {
  const events = [];
  const runtime = {
    eventListener: { onEvent: (event = {}) => events.push(event) },
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
      attachments: [{
        identity: {
          attachmentId: "search-attachment-1",
          sessionId: "session-1",
          attachmentSource: "model",
        },
        role: "primary",
        name: "search.result.txt",
        mimeType: "text/plain",
        size: 1301812,
      }],
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

  assert.equal(commitAuthoritativeFinalResult({ result, runtime }), true);

  const finalEvent = events.find((event) => event?.event === "authoritative_final_content");
  assert.deepEqual(finalEvent?.data?.transferEnvelopes, [transferEnvelope]);
  assert.deepEqual(
    runtime.currentTurnMessages.toArray().find((message) => message.messageId === "assistant-message-1")?.transferEnvelopes,
    [transferEnvelope],
  );
  assert.deepEqual(
    result.turnMessages.find((message) => message.messageId === "assistant-message-1")?.transferEnvelopes,
    [transferEnvelope],
  );
  assert.equal(
    result.turnMessages.find((message) => message.messageId === "final-hook-control-1")?.summarized,
    true,
  );
});
