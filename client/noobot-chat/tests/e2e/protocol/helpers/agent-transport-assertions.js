/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { AGENT_COMMAND, validateAgentCommand } from "@noobot/agent-transport-protocol";

const RUN_COMMANDS = new Set([AGENT_COMMAND.SEND, AGENT_COMMAND.RESEND, AGENT_COMMAND.CONTINUE]);

export function assertAgentTransportCommand(command, expected = {}) {
  expect(validateAgentCommand(command)).toEqual({ valid: true, errors: [] });
  expect(command.protocolVersion).toBe(2);
  expect(command.commandId).toBeTruthy();
  expect(command.identity?.sessionId).toBe(expected.sessionId);
  if (RUN_COMMANDS.has(command.commandType)) {
    expect(command.identity?.turnScopeId).toMatch(/^client-turn:/);
    expect(command.concurrency?.expectedTurnRevision).toBe(0);
    expect(Array.isArray(command.input?.attachments)).toBe(true);
  }
  if (command.commandType === AGENT_COMMAND.STOP) {
    expect(command.identity?.turnScopeId).toMatch(/^client-turn:/);
    expect(command.concurrency?.expectedTurnRevision).toBeGreaterThanOrEqual(1);
  }
  if (command.commandType === AGENT_COMMAND.CONTINUE) {
    expect(command.continuation?.dialogProcessId).toBeTruthy();
    expect(command.continuation?.turnScopeId).toBeTruthy();
  }
}

export function assertUniqueCommandIds(commands = []) {
  const ids = commands.map((command) => command.commandId);
  expect(new Set(ids).size).toBe(ids.length);
}
