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
  createTurnInterjectionCommand,
  createTurnRunCommand,
  createTurnStopCommand,
  parseAgentCommand,
} from "../src/index.js";

test("turn interjection binds text to the active Turn and dialog identity", () => {
  const command = createTurnInterjectionCommand({
    commandId: "interject:1",
    identity: {
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
    },
    interaction: { message: "check the new constraint" },
  });

  assert.equal(parseAgentCommand(command), command);
  assert.equal(command.commandType, AGENT_COMMAND.INTERJECT);
  assert.deepEqual(command.interaction, { message: "check the new constraint" });

  delete command.identity.dialogProcessId;
  assert.throws(() => parseAgentCommand(command), /missing_dialog_process_id/);
  command.identity.dialogProcessId = "dialog-1";
  command.interaction.message = "  ";
  assert.throws(() => parseAgentCommand(command), /missing_interjection_message/);
});

test("turn send command has one canonical location for transport fields", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    input: { message: "hello", attachments: [] },
    preferences: { streaming: true, selectedPlugins: ["planning"] },
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: {
      expectedTurnRevision: 0,
      expectedAggregateVersion: 3,
    },
    session: { createIfAbsent: false },
  });

  assert.equal(parseAgentCommand(command), command);
  assert.equal(command.identity.turnScopeId, "turn-1");
  assert.equal(command.presentation.assistantMessageId, "assistant-1");
  assert.equal(command.session.createIfAbsent, false);
  assert.equal(command.protocolVersion, 2);
  assert.equal(command.concurrency.expectedTurnRevision, 0);
  assert.equal(command.concurrency.expectedAggregateVersion, 3);
  assert.equal("config" in command, false);
  assert.equal("userId" in command, false);
  assert.equal("thinkingStartedAt" in command.preferences, false);
});

test("session provision intent is explicit and only valid for turn.send", () => {
  const runInput = {
    identity: { sessionId: "session-new", turnScopeId: "turn-new" },
    input: { message: "hello", attachments: [] },
    preferences: {},
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 0 },
    session: { createIfAbsent: true },
  };
  const initialSend = createTurnRunCommand({ ...runInput, commandType: AGENT_COMMAND.SEND });
  assert.equal(parseAgentCommand(initialSend).session.createIfAbsent, true);

  const resend = createTurnRunCommand({
    ...runInput,
    commandType: AGENT_COMMAND.RESEND,
    identity: { ...runInput.identity, dialogProcessId: "dialog-resend" },
  });
  assert.throws(() => parseAgentCommand(resend), /create_if_absent_requires_send/);
});

test("turn resend requires the dialog identity committed by session replacement", () => {
  const resend = createTurnRunCommand({
    commandType: AGENT_COMMAND.RESEND,
    identity: {
      sessionId: "session-1",
      dialogProcessId: "dialog-resend",
      turnScopeId: "turn-resend",
    },
    input: { message: "edited", attachments: [] },
    preferences: {},
    presentation: { userMessageId: "user-resend", assistantMessageId: "assistant-resend" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 4 },
    session: { createIfAbsent: false },
  });
  assert.equal(parseAgentCommand(resend).identity.dialogProcessId, "dialog-resend");
  delete resend.identity.dialogProcessId;
  assert.throws(() => parseAgentCommand(resend), /missing_resend_dialog_process_id/);
});

test("send and continue reject client-supplied dialog identity allocated at acceptance", () => {
  for (const commandType of [AGENT_COMMAND.SEND, AGENT_COMMAND.CONTINUE]) {
    const command = createTurnRunCommand({
      commandType,
      identity: {
        sessionId: "session-1",
        dialogProcessId: "dialog-client",
        turnScopeId: `turn-${commandType}`,
      },
      input: { message: "hello", attachments: [] },
      preferences: {},
      presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
      concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 1 },
      session: { createIfAbsent: false },
      continuation: { dialogProcessId: "dialog-stopped", turnScopeId: "turn-stopped" },
    });
    assert.throws(() => parseAgentCommand(command), /unexpected_dialog_process_id/);
    delete command.identity.dialogProcessId;
    assert.equal(parseAgentCommand(command).identity.dialogProcessId, undefined);
  }
});

test("run commands require presentation identity for both user and assistant messages", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    identity: { sessionId: "session-1", turnScopeId: "turn-presentation" },
    input: { message: "hello", attachments: [] },
    preferences: {},
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 0 },
  });
  assert.equal(parseAgentCommand(command).presentation.userMessageId, "user-1");
  delete command.presentation.assistantMessageId;
  assert.throws(() => parseAgentCommand(command), /missing_assistant_message_id/);
  delete command.presentation.userMessageId;
  assert.throws(() => parseAgentCommand(command), /missing_user_message_id/);
});

test("run concurrency separates turn revision from session version", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    input: { message: "hello", attachments: [] },
    preferences: {},
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 7 },
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
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    concurrency: { expectedTurnRevision: 2 },
    stop: {},
  });
  assert.equal(parseAgentCommand(command), command);
  assert.equal(command.concurrency.expectedTurnRevision, 2);

  assert.throws(
    () =>
      createTurnStopCommand({
        identity: { sessionId: "session-1", turnScopeId: "turn-1" },
        concurrency: {},
        stop: {},
      }),
    /invalid_expected_turn_revision/,
  );
  command.concurrency.expectedTurnRevision = 0;
  assert.throws(() => parseAgentCommand(command), /invalid_expected_turn_revision/);
});

test("protocol rejects legacy and unknown top-level fields", () => {
  assert.throws(
    () =>
      parseAgentCommand(
        JSON.stringify({
          action: "continue",
          userId: "user-1",
          sessionId: "session-1",
          message: "legacy",
          config: {},
        }),
      ),
    /unsupported_protocol_version/,
  );

  const command = createInteractionResponseCommand({
    identity: { sessionId: "session-1" },
    interaction: { requestId: "request-1", response: { accepted: true } },
  });
  command.config = {};
  assert.throws(() => parseAgentCommand(command), /unknown_top_level_field:config/);
});

test("protocol rejects ambiguous boolean strings", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    input: { message: "hello", attachments: [] },
    preferences: {},
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 0 },
  });
  command.preferences.streaming = "false";
  assert.throws(() => parseAgentCommand(command), /invalid_streaming/);
  command.preferences.streaming = false;
  command.preferences.safeConfirm = "false";
  assert.throws(() => parseAgentCommand(command), /invalid_safeConfirm/);
});

test("run preferences preserve an explicit disabled safety confirmation", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    identity: { sessionId: "session-1", turnScopeId: "turn-no-confirm" },
    input: { message: "hello", attachments: [] },
    preferences: { safeConfirm: false },
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 0 },
  });

  assert.equal(command.preferences.safeConfirm, false);
  assert.equal(parseAgentCommand(command), command);
});

test("run transport carries connector selection only as new Session creation state", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    identity: { sessionId: "session-1", turnScopeId: "turn-connectors" },
    input: { message: "hello", attachments: [] },
    preferences: { selectedConnectorIds: ["con_untrusted_request"] },
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 0 },
    session: { createIfAbsent: true, selectedConnectorIds: ["con_initial"] },
  });

  assert.equal("selectedConnectorIds" in command.preferences, false);
  assert.deepEqual(command.session.selectedConnectorIds, ["con_initial"]);

  command.session.createIfAbsent = false;
  assert.throws(() => parseAgentCommand(command), /unexpected_session_selected_connector_ids/);
});

test("run summary and task-check policy has one strict per-run transport shape", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    identity: { sessionId: "session-1", turnScopeId: "turn-summary" },
    input: { message: "summarize after one loop", attachments: [] },
    preferences: {
      frontendThresholdsEnabled: true,
      summaryPolicy: { phaseSummaryLoopTurns: 1, taskCheckLoopTurns: 2 },
    },
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 0 },
  });

  assert.deepEqual(command.preferences.summaryPolicy, {
    phaseSummaryLoopTurns: 1,
    taskCheckLoopTurns: 2,
  });
  assert.equal(command.preferences.frontendThresholdsEnabled, true);
  assert.equal(parseAgentCommand(command), command);

  command.preferences.summaryPolicy.legacyTurns = 1;
  assert.throws(() => parseAgentCommand(command), /unknown_summary_policy_field:legacyTurns/);
  delete command.preferences.summaryPolicy.legacyTurns;
  command.preferences.summaryPolicy.phaseSummaryLoopTurns = 0;
  assert.throws(() => parseAgentCommand(command), /invalid_phase_summary_loop_turns/);
  command.preferences.summaryPolicy.phaseSummaryLoopTurns = 1;
  command.preferences.summaryPolicy.taskCheckLoopTurns = 0;
  assert.throws(() => parseAgentCommand(command), /invalid_task_check_loop_turns/);
  command.preferences.summaryPolicy.taskCheckLoopTurns = 2;
  command.preferences.frontendThresholdsEnabled = "true";
  assert.throws(() => parseAgentCommand(command), /invalid_frontend_thresholds_enabled/);
});

test("protocol rejects unknown nested fields and irrelevant command sections", () => {
  const command = createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    identity: { sessionId: "session-1", turnScopeId: "turn-1" },
    input: { message: "hello", attachments: [] },
    preferences: {},
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 0 },
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
    identity: { sessionId: "session-1", turnScopeId: "turn-2" },
    input: { message: "continue", attachments: [] },
    preferences: {},
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 0 },
    continuation: {},
  });
  assert.throws(() => parseAgentCommand(command), /missing_continuation_dialog_process_id/);
});

test("turn-scoped command ids are derived by the protocol and cannot be supplied", () => {
  const input = {
    commandType: AGENT_COMMAND.SEND,
    identity: { sessionId: "session-1", turnScopeId: "turn-derived" },
    input: { message: "hello", attachments: [] },
    preferences: {},
    presentation: { userMessageId: "user-1", assistantMessageId: "assistant-1" },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 0 },
  };
  assert.throws(
    () => createTurnRunCommand({ ...input, commandId: "turn-derived" }),
    /command_id_is_protocol_derived/,
  );
  const command = createTurnRunCommand(input);
  assert.equal(command.commandId, "turn-derived");
  assert.equal(
    createTurnStopCommand({
      identity: { sessionId: "session-1", turnScopeId: "turn-derived" },
      concurrency: { expectedTurnRevision: 1 },
      stop: {},
    }).commandId,
    "stop:turn-derived",
  );
  assert.equal(
    createInteractionResponseCommand({
      identity: { sessionId: "session-1" },
      interaction: { requestId: "request-1", response: {} },
    }).commandId,
    "interaction:request-1",
  );

  command.commandId = "forged";
  assert.throws(() => parseAgentCommand(command), /command_id_not_derived/);
});
