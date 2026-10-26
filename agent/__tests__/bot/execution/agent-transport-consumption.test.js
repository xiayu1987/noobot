/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentTransportConsumption } from "../../../src/bot/execution/runner/agent-transport-consumption.js";

function consumptionInput({
  messageEventStream = { activePresentationMessageId: "assistant-message-1" },
} = {}) {
  return {
    transportCommand: { protocolVersion: 2, commandType: "turn.send", commandId: "turn-1" },
    identity: {
      sessionId: "session-1",
      parentSessionId: "",
      dialogProcessId: "dialog-1",
      parentDialogProcessId: "",
      turnScopeId: "turn-1",
    },
    normalizedMessage: "hello",
    requestedAttachments: [{ id: "upload-1" }],
    canonicalAttachments: [{ attachmentId: "attachment-1" }],
    currentUserMessage: {
      userMessageId: "user-message-1",
      content: "hello",
      attachments: [{ attachmentId: "attachment-1" }],
    },
    resolvedRunConfig: {
      userMessageId: "user-message-1",
      presentationMessageId: "assistant-message-1",
      allowUserInteraction: false,
      sanitizeOutput: true,
      streaming: false,
      safeConfirmLevel: "high",
      locale: "zh-CN",
      scenario: "programming",
      selectedModel: "model-main",
      memoryModel: "model-memory",
      selectedPlugins: ["harness"],
      pluginModelConfig: { harness: { enabled: true } },
      selectedConnectorIds: ["con_terminal"],
      commandId: "turn-1",
      expectedAggregateVersion: 3,
    },
    committedTurnResult: { aggregateVersion: 4 },
    dispatchRuntime: {
      systemRuntime: { messageEventStream },
    },
  };
}

test("Agent transport consumption proves normalized fields reached their runtime consumers", () => {
  const result = buildAgentTransportConsumption(consumptionInput());

  assert.equal(result.protocolVersion, 2);
  assert.equal(result.commandType, "turn.send");
  assert.equal(result.commandId, "turn-1");
  assert.equal(result.identity.sessionId, "session-1");
  assert.equal(result.identity.dialogProcessId, "dialog-1");
  assert.equal(result.input.messageConsumed, true);
  assert.equal(result.input.requestedAttachmentCount, 1);
  assert.equal(result.input.canonicalAttachmentCount, 1);
  assert.equal(result.input.persistedAttachmentCount, 1);
  assert.deepEqual(result.preferences, {
    allowUserInteraction: false,
    sanitizeOutput: true,
    streaming: false,
    safeConfirmLevel: "high",
    locale: "zh-CN",
    scenario: "programming",
    selectedModel: "model-main",
    memoryModel: "model-memory",
    selectedPlugins: ["harness"],
    pluginModelConfigKeys: ["harness"],
    selectedConnectorIds: ["con_terminal"],
  });
  assert.equal(result.presentation.userMessageIdConsumed, true);
  assert.equal(result.presentation.requestedPresentationMessageId, "assistant-message-1");
  assert.equal(result.presentation.boundPresentationMessageId, "assistant-message-1");
  assert.equal(result.presentation.presentationMessageIdConsumed, true);
  assert.equal(result.concurrency.commandId, "turn-1");
  assert.equal("commandIdConsumed" in result.concurrency, false);
  assert.equal(result.concurrency.expectedAggregateVersion, 3);
  assert.equal(result.concurrency.committedAggregateVersion, 4);
  assert.equal(JSON.stringify(result).includes("hello"), false);
});

test("Agent transport consumption reports unbound presentation identity as not consumed", () => {
  const result = buildAgentTransportConsumption(
    consumptionInput({ messageEventStream: { activePresentationMessageId: "" } }),
  );

  assert.equal(result.presentation.requestedPresentationMessageId, "assistant-message-1");
  assert.equal(result.presentation.boundPresentationMessageId, "");
  assert.equal(result.presentation.presentationMessageIdConsumed, false);
});
