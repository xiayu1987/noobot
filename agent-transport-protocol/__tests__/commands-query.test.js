/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_COMMAND,
  createExecutionQueryCommand,
  createTurnFinalizeCommand,
  createTurnInterjectionCommand,
  createTurnSnapshotCommand,
  parseAgentCommand,
} from "../src/index.js";
import { TURN_SNAPSHOT_TERMINAL_LIMIT } from "@noobot/session-protocol/turn-lifecycle";

const identity = { sessionId: "session-1" };

test("snapshot command carries explicit known sequence and terminal limit", () => {
  const command = createTurnSnapshotCommand({
    commandId: "snapshot-1",
    identity,
    options: { knownSequence: 0, terminalLimit: TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT },
  });
  assert.deepEqual(parseAgentCommand(command).options, { knownSequence: 0, terminalLimit: 10 });
  for (const [options, code] of [
    [{ terminalLimit: 10 }, /invalid_known_sequence/],
    [{ knownSequence: -1, terminalLimit: 10 }, /invalid_known_sequence/],
    [{ knownSequence: "3", terminalLimit: 10 }, /invalid_known_sequence/],
    [{ knownSequence: 0 }, /invalid_terminal_limit/],
    [{ knownSequence: 0, terminalLimit: 101 }, /invalid_terminal_limit/],
    [{ knownSequence: 0, terminalLimit: 1.5 }, /invalid_terminal_limit/],
  ]) {
    assert.throws(
      () => createTurnSnapshotCommand({ commandId: "snapshot-1", identity, options }),
      code,
    );
  }
});

test("finalize command requires a protocol terminal limit", () => {
  const command = createTurnFinalizeCommand({
    commandId: "finalize-1",
    identity,
    options: { terminalLimit: TURN_SNAPSHOT_TERMINAL_LIMIT.MAX },
  });
  assert.deepEqual(command.options, { terminalLimit: 100 });
  assert.throws(
    () => createTurnFinalizeCommand({ commandId: "finalize-1", identity, options: {} }),
    /invalid_terminal_limit/,
  );
});

test("execution query carries both target fields and follows the protocol target rule", () => {
  const tree = createExecutionQueryCommand({
    commandType: AGENT_COMMAND.EXECUTION_TREE_GET,
    commandId: "query-1",
    identity,
    query: { executionId: "", rootExecutionId: "root-1" },
  });
  assert.deepEqual(tree.query, { executionId: "", rootExecutionId: "root-1" });
  for (const [commandType, query, code] of [
    [AGENT_COMMAND.EXECUTION_TREE_GET, { rootExecutionId: "root-1" }, /invalid_query_field/],
    [AGENT_COMMAND.EXECUTION_TREE_GET, { executionId: "", rootExecutionId: " r " }, /query_field/],
    [
      AGENT_COMMAND.EXECUTION_SNAPSHOT_GET,
      { executionId: "", rootExecutionId: "root-1" },
      /invalid_execution_query_target/,
    ],
  ]) {
    assert.throws(
      () => createExecutionQueryCommand({ commandType, commandId: "query-1", identity, query }),
      code,
    );
  }
});

test("command builders reject missing command id and empty interjection at construction", () => {
  assert.throws(
    () =>
      createTurnInterjectionCommand({
        commandId: "",
        identity: { sessionId: "session-1", dialogProcessId: "dialog-1", turnScopeId: "turn-1" },
        interaction: { message: "hi" },
      }),
    /missing_command_id/,
  );
  assert.throws(
    () =>
      createTurnInterjectionCommand({
        commandId: "command-1",
        identity: { sessionId: "session-1", dialogProcessId: "dialog-1", turnScopeId: "turn-1" },
        interaction: { message: "" },
      }),
    /missing_interjection_message/,
  );
});
