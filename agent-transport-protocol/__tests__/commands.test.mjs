/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_COMMAND,
  createInteractionResponseCommand,
  createTurnRunCommand,
  parseAgentCommand,
} from "../src/index.mjs";

test("turn send command has one canonical location for transport fields", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    commandId: "turn-1",
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    input: { message: "hello", attachments: [] },
    preferences: { streaming: true, selectedPlugins: ["planning"] },
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { idempotencyKey: "turn-1", expectedRevision: 3 },
  });

  assert.equal(parseAgentCommand(command), command);
  assert.equal(command.identity.turnScopeId, "turn-1");
  assert.equal(command.presentation.assistantMessageId, "assistant-1");
  assert.equal("config" in command, false);
  assert.equal("userId" in command, false);
  assert.equal("thinkingStartedAt" in command.preferences, false);
});

test("protocol rejects legacy and unknown top-level fields", () => {
  assert.throws(() => parseAgentCommand(JSON.stringify({
    action: "continue",
    userId: "user-1",
    sessionId: "session-1",
    message: "legacy",
    config: {},
  })), /unsupported_protocol_version/);

  const command = createInteractionResponseCommand({
    commandId: "interaction:request-1",
    identity: { sessionId: "session-1" },
    interaction: { requestId: "request-1", response: { accepted: true } },
  });
  command.config = {};
  assert.throws(() => parseAgentCommand(command), /unknown_top_level_field:config/);
});

test("protocol rejects ambiguous boolean strings", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    commandId: "turn-1",
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    input: { message: "hello", attachments: [] },
    preferences: {},
    presentation: {},
    concurrency: {},
  });
  command.preferences.streaming = "false";
  assert.throws(() => parseAgentCommand(command), /invalid_streaming/);
});

test("protocol rejects unknown nested fields and irrelevant command sections", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    commandId: "turn-1",
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    input: { message: "hello", attachments: [] },
    preferences: {},
    presentation: {},
    concurrency: {},
  });
  command.identity.userId = "forged-user";
  command.preferences.runTimeoutMs = 1;
  command.stop = {};

  assert.throws(() => parseAgentCommand(command), /unknown_identity_field:userId/);
  assert.throws(() => parseAgentCommand(command), /unknown_preferences_field:runTimeoutMs/);
  assert.throws(() => parseAgentCommand(command), /unexpected_top_level_field:stop/);
});

test("continue requires an explicit continuation source", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.CONTINUE,
    commandId: "turn-2",
    identity: { sessionId: "session-1", turnScopeId: "turn-2" },
    input: { message: "continue", attachments: [] },
    preferences: {},
    presentation: {},
    concurrency: {},
    continuation: {},
  });
  assert.throws(() => parseAgentCommand(command), /missing_continuation_dialog_process_id/);
});
