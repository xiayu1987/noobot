/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { assertModelMessageSnapshot } from "./snapshot-assertions.js";
import { addAttachment, editLatestUserMessage, sendMessage, stopActiveTurn } from "./browser-actions.js";
import { readSnapshots } from "./persistence-audit.js";
import {
  assertCommandChain, assertContinuation, assertTurnLifecycle, commandsForSession,
  lifecycleForSession, waitForCommand, waitForLifecycle,
} from "./scenario-assertions.js";

export function uniquePrompt(testInfo, purpose = "protocol") {
  return `[PBE:${testInfo.testId}:${Date.now()}] ${purpose}`;
}

export async function sendAndStop({ page, capture, sessionId, prompt, attachment = null }) {
  const beforeCommands = commandsForSession(capture, sessionId).length;
  if (attachment) await addAttachment(page, attachment);
  await sendMessage(page, prompt);
  const send = await waitForCommand(capture, sessionId, "turn.send", beforeCommands);
  const processing = await waitForLifecycle(capture, sessionId, "turn.processing_started", 0, send.identity.turnScopeId);
  const authoritativeSend = { ...send, identity: { ...send.identity, dialogProcessId: processing.dialogProcessId } };
  await stopActiveTurn(page);
  const stop = await waitForCommand(capture, sessionId, "turn.stop", beforeCommands);
  await waitForLifecycle(capture, sessionId, "turn.stop_completed", 0, send.identity.turnScopeId);
  assertCommandChain(capture, sessionId);
  assertTurnLifecycle(capture, sessionId, send.identity.turnScopeId);
  expect(stop.identity).toMatchObject(authoritativeSend.identity);
  return { send: authoritativeSend, stop };
}

export async function continueAndStop({ page, capture, sessionId, previous, prompt }) {
  const beforeCommands = commandsForSession(capture, sessionId).length;
  await sendMessage(page, prompt);
  const next = await waitForCommand(capture, sessionId, "turn.continue", beforeCommands);
  assertContinuation(previous, next);
  const processing = await waitForLifecycle(capture, sessionId, "turn.processing_started", 0, next.identity.turnScopeId);
  await stopActiveTurn(page);
  await waitForCommand(capture, sessionId, "turn.stop", beforeCommands);
  await waitForLifecycle(capture, sessionId, "turn.stop_completed", 0, next.identity.turnScopeId);
  assertTurnLifecycle(capture, sessionId, next.identity.turnScopeId);
  return { ...next, identity: { ...next.identity, dialogProcessId: processing.dialogProcessId } };
}

export async function assertPersistedSnapshots(userId, sessionId, count) {
  const snapshots = await readSnapshots(userId, sessionId);
  expect(snapshots).toHaveLength(count);
  snapshots.forEach(assertModelMessageSnapshot);
  return snapshots;
}

export async function resendAndStop({ page, capture, sessionId, content, attachment = null, removeAttachments = false }) {
  const beforeCommands = commandsForSession(capture, sessionId).length;
  await editLatestUserMessage(page, content, { attachment, removeAttachments });
  const resend = await waitForCommand(capture, sessionId, "turn.resend", beforeCommands);
  const processing = await waitForLifecycle(capture, sessionId, "turn.processing_started", 0, resend.identity.turnScopeId);
  await stopActiveTurn(page);
  await waitForLifecycle(capture, sessionId, "turn.stop_completed", 0, resend.identity.turnScopeId);
  assertTurnLifecycle(capture, sessionId, resend.identity.turnScopeId);
  return { ...resend, identity: { ...resend.identity, dialogProcessId: processing.dialogProcessId } };
}
