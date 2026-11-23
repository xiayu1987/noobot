/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { isSettlingTurnEvent, TURN_COMMAND } from "@noobot/session-protocol/turn-lifecycle";
import {
  assertAgentTransportCommand,
  assertUniqueCommandIds,
} from "./agent-transport-assertions.js";
import { assertLifecycleSequence, assertSingleTerminal } from "./lifecycle-assertions.js";
import {
  findAgentCommands,
  findLifecycleEnvelopes,
  findLifecycleReceipts,
  waitForCaptured,
} from "./websocket-capture.js";
import { PROTOCOL_TIMEOUTS } from "./protocol-timeouts.js";

export function commandsForSession(capture, sessionId) {
  return findAgentCommands(capture.websocketSent).filter(
    (item) => item.identity?.sessionId === sessionId,
  );
}

export function lifecycleForSession(capture, sessionId) {
  return findLifecycleEnvelopes(capture.websocketReceived).filter(
    (item) => item.sessionId === sessionId,
  );
}

export async function waitForCommand(capture, sessionId, commandType, after = 0) {
  return waitForCaptured(() =>
    commandsForSession(capture, sessionId)
      .slice(after)
      .find((command) => command.commandType === commandType),
  );
}

export async function waitForLifecycle(capture, sessionId, eventType, after = 0, turnScopeId = "") {
  return waitForCaptured(
    () =>
      lifecycleForSession(capture, sessionId)
        .slice(after)
        .find(
          (event) =>
            event.eventType === eventType && (!turnScopeId || event.turnScopeId === turnScopeId),
        ),
    { timeoutMs: PROTOCOL_TIMEOUTS.model },
  );
}

export async function waitForTurnTerminal(
  capture,
  sessionId,
  turnScopeId = "",
  { timeoutMs = PROTOCOL_TIMEOUTS.model } = {},
) {
  return capture.waitForReceivedFrame(
    (frame) =>
      findLifecycleEnvelopes([frame]).find(
        (event) =>
          event.sessionId === sessionId &&
          isSettlingTurnEvent(event) &&
          (!turnScopeId || event.turnScopeId === turnScopeId),
      ),
    timeoutMs,
  );
}

export async function settleSessionBeforeCleanup(capture, sessionId, stop) {
  const latestTurn = commandsForSession(capture, sessionId).findLast(({ commandType }) =>
    [TURN_COMMAND.SEND, TURN_COMMAND.RESEND, TURN_COMMAND.CONTINUE].includes(commandType),
  );
  if (!latestTurn) return;
  const { turnScopeId } = latestTurn.identity;
  const settled = lifecycleForSession(capture, sessionId).some(
    (event) => event.turnScopeId === turnScopeId && isSettlingTurnEvent(event),
  );
  if (!settled) await stop();
  return waitForTurnTerminal(capture, sessionId, turnScopeId);
}

export function assertCommandChain(capture, sessionId) {
  const commands = commandsForSession(capture, sessionId);
  expect(commands.length).toBeGreaterThan(0);
  commands.forEach((command) => assertAgentTransportCommand(command, { sessionId }));
  assertUniqueCommandIds(commands);
  return commands;
}

export async function assertTurnLifecycle(capture, sessionId, turnScopeId) {
  const events = lifecycleForSession(capture, sessionId).filter(
    (event) => event.turnScopeId === turnScopeId,
  );
  assertLifecycleSequence(events);
  assertSingleTerminal(events);
  let receipts;
  await expect
    .poll(() => {
      receipts = findLifecycleReceipts(capture.websocketSent).filter(
        (receipt) => receipt.sessionId === sessionId && receipt.turnScopeId === turnScopeId,
      );
      return new Set(receipts.map((receipt) => receipt.eventId));
    })
    .toEqual(new Set(events.map((event) => event.eventId)));
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
