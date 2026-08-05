/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { assertAgentTransportCommand, assertUniqueCommandIds } from "./agent-transport-assertions.js";
import { assertLifecycleSequence, assertSingleTerminal } from "./lifecycle-assertions.js";
import { findAgentCommands, findLifecycleEnvelopes, findLifecycleReceipts, waitForCaptured } from "./websocket-capture.js";

export function commandsForSession(capture, sessionId) {
  return findAgentCommands(capture.websocketSent).filter((item) => item.identity?.sessionId === sessionId);
}

export function lifecycleForSession(capture, sessionId) {
  return findLifecycleEnvelopes(capture.websocketReceived).filter((item) => item.sessionId === sessionId);
}

export async function waitForCommand(capture, sessionId, commandType, after = 0) {
  return waitForCaptured(() => commandsForSession(capture, sessionId)
    .slice(after).find((command) => command.commandType === commandType));
}

export async function waitForLifecycle(capture, sessionId, eventType, after = 0, turnScopeId = "") {
  return waitForCaptured(() => lifecycleForSession(capture, sessionId)
    .slice(after).find((event) => event.eventType === eventType && (!turnScopeId || event.turnScopeId === turnScopeId)), { timeoutMs: 120_000 });
}

export function assertCommandChain(capture, sessionId) {
  const commands = commandsForSession(capture, sessionId);
  expect(commands.length).toBeGreaterThan(0);
  commands.forEach((command) => assertAgentTransportCommand(command, { sessionId }));
  assertUniqueCommandIds(commands);
  return commands;
}

export function assertTurnLifecycle(capture, sessionId, turnScopeId) {
  const events = lifecycleForSession(capture, sessionId).filter((event) => event.turnScopeId === turnScopeId);
  assertLifecycleSequence(events);
  assertSingleTerminal(events);
  const receipts = findLifecycleReceipts(capture.websocketSent)
    .filter((receipt) => receipt.sessionId === sessionId && receipt.turnScopeId === turnScopeId);
  expect(new Set(receipts.map((receipt) => receipt.eventId))).toEqual(new Set(events.map((event) => event.eventId)));
  expect(receipts.every((receipt) => receipt.protocolVersion === 1)).toBe(true);
  return events;
}

export function assertContinuation(previous, next) {
  expect(next.identity.turnScopeId).not.toBe(previous.identity.turnScopeId);
  expect(next.continuation).toEqual({
    dialogProcessId: previous.identity.dialogProcessId,
    turnScopeId: previous.identity.turnScopeId,
  });
}
