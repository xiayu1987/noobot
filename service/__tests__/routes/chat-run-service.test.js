/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_COMMAND,
  createTurnRunCommand,
} from "@noobot/agent-transport-protocol";
import { createChatRunService } from "../../services/chat-run-service.js";

function createService() {
  return createChatRunService({
    getBot: () => ({}),
    normalizeLocale: (locale = "") => String(locale || "").trim() || "zh-CN",
    defaultLocale: "zh-CN",
    translateText: (key = "") => String(key || ""),
  });
}

function createCommand(overrides = {}) {
  return createTurnRunCommand({
    commandType: overrides.commandType || AGENT_COMMAND.SEND,
    commandId: "turn-1",
    identity: {
      sessionId: "session-1",
      ...(overrides.commandType === AGENT_COMMAND.RESEND ? { dialogProcessId: "dialog-resend" } : {}),
      turnScopeId: "turn-1",
    },
    input: { message: "hello", attachments: [] },
    preferences: {
      locale: "en-US",
      streaming: true,
      selectedModel: "gpt-5.5",
      memoryModel: "memory-gpt",
      pluginModelConfig: { web_search: { semanticModel: "gpt-4.1-mini" } },
      frontendThresholdsEnabled: true,
      summaryPolicy: { phaseSummaryLoopTurns: 1 },
      selectedPlugins: ["planning"],
      selectedConnectors: { terminal: "local" },
    },
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: {
      expectedTurnRevision: 0,
      expectedAggregateVersion: 3,
    },
    session: { createIfAbsent: overrides.createIfAbsent === true },
    continuation: overrides.continuation,
  });
}

test("chat-run-service maps a validated transport command without a compat config", () => {
  const request = createService().mapAgentRunCommand(createCommand(), { userId: "user-1" });

  assert.equal(request.userId, "user-1");
  assert.equal(request.sessionId, "session-1");
  assert.equal(request.runConfig.selectedModel, "gpt-5.5");
  assert.equal(request.runConfig.memoryModel, "memory-gpt");
  assert.equal(request.runConfig.frontendThresholdsEnabled, true);
  assert.deepEqual(request.runConfig.summaryPolicy, { phaseSummaryLoopTurns: 1 });
  assert.equal(request.runConfig.presentationMessageId, "assistant-1");
  assert.equal(request.runConfig.userMessageId, "user-1");
  assert.equal(request.runConfig.commandId, "turn-1");
  assert.equal(request.runConfig.expectedAggregateVersion, 3);
  assert.equal(request.expectedRevision, 0);
  assert.equal(request.createSessionIfAbsent, false);
  assert.deepEqual(request.runConfig.transportCommand, {
    protocolVersion: 2,
    commandType: "turn.send",
    commandId: "turn-1",
  });
  assert.deepEqual(request.runConfig.selectedConnectors, {
    database: "",
    terminal: "local",
    email: "",
  });
  assert.deepEqual(request.runConfig.selectedPlugins, ["planning"]);
  assert.equal(request.runConfig.safeConfirm, true);
  assert.equal("config" in request.runConfig, false);
  assert.equal("runTimeoutMs" in request.runConfig, false);
  assert.equal("thinkingStartedAt" in request.runConfig, false);
});

test("chat-run-service consumes explicit session provision intent", () => {
  const request = createService().mapAgentRunCommand(
    createCommand({ createIfAbsent: true }),
    { userId: "user-1" },
  );
  assert.equal(request.createSessionIfAbsent, true);
});

test("chat-run-service derives resend and continuation flags from commandType", () => {
  const service = createService();
  const resend = service.mapAgentRunCommand(createCommand({ commandType: AGENT_COMMAND.RESEND }), { userId: "user-1" });
  const continued = service.mapAgentRunCommand(createCommand({
    commandType: AGENT_COMMAND.CONTINUE,
    continuation: { dialogProcessId: "dialog-1", turnScopeId: "turn-old" },
  }), { userId: "user-1" });

  assert.equal(resend.runConfig.reuseExistingUserTurn, true);
  assert.equal(resend.dialogProcessId, "dialog-resend");
  assert.equal(continued.runConfig.resumeFromStoppedSnapshot, true);
  assert.equal(continued.runConfig.resumeDialogProcessId, "dialog-1");
  assert.equal(continued.runConfig.resumeTurnScopeId, "turn-old");
});
