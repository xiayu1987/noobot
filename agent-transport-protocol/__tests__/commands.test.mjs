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
  createTurnStopCommand,
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
    concurrency: {
      idempotencyKey: "turn-1",
      expectedTurnRevision: 0,
      expectedSessionVersion: 3,
    },
    session: { createIfAbsent: false },
  });

  assert.equal(parseAgentCommand(command), command);
  assert.equal(command.identity.turnScopeId, "turn-1");
  assert.equal(command.presentation.assistantMessageId, "assistant-1");
  assert.equal(command.session.createIfAbsent, false);
  assert.equal(command.protocolVersion, 2);
  assert.equal(command.concurrency.expectedTurnRevision, 0);
  assert.equal(command.concurrency.expectedSessionVersion, 3);
  assert.equal("config" in command, false);
  assert.equal("userId" in command, false);
  assert.equal("thinkingStartedAt" in command.preferences, false);
});

test("session provision intent is explicit and only valid for turn.send", () => {
  const initialSend = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    commandId: "turn-new",
    identity: { sessionId: "session-new", turnScopeId: "turn-new" },
    input: { message: "hello", attachments: [] },
    preferences: {}, presentation: {},
    concurrency: { expectedTurnRevision: 0, expectedSessionVersion: 0 },
    session: { createIfAbsent: true },
  });
  assert.equal(parseAgentCommand(initialSend).session.createIfAbsent, true);

  const resend = createTurnRunCommand({
    ...initialSend,
    commandType: AGENT_COMMAND.RESEND,
    session: { createIfAbsent: true },
  });
  assert.throws(() => parseAgentCommand(resend), /create_if_absent_requires_send/);
});

test("run concurrency separates turn revision from session version", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    commandId: "turn-1",
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    input: { message: "hello", attachments: [] },
    preferences: {}, presentation: {},
    concurrency: { expectedTurnRevision: 0, expectedSessionVersion: 7 },
  });
  assert.equal(parseAgentCommand(command), command);

  command.concurrency.expectedRevision = 7;
  assert.throws(() => parseAgentCommand(command), /unknown_concurrency_field:expectedRevision/);
  delete command.concurrency.expectedRevision;
  command.concurrency.expectedTurnRevision = 7;
  assert.throws(() => parseAgentCommand(command), /run_turn_revision_must_be_zero/);
});

test("turn stop requires the current positive authoritative turn revision", () => {
  const command = createTurnStopCommand({
    commandId: "stop:turn-1",
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    concurrency: { expectedTurnRevision: 2 },
    stop: {},
  });
  assert.equal(parseAgentCommand(command), command);
  assert.equal(command.concurrency.expectedTurnRevision, 2);

  assert.throws(() => createTurnStopCommand({
    commandId: "stop:turn-1",
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    concurrency: {},
    stop: {},
  }), /invalid_expected_turn_revision/);
  command.concurrency.expectedTurnRevision = 0;
  assert.throws(() => parseAgentCommand(command), /invalid_expected_turn_revision/);
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
