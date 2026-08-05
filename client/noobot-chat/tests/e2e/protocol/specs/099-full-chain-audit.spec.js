/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { fixedAttachment, selectPlugins } from "../helpers/browser-actions.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { assertCommandChain, assertContinuation, lifecycleForSession } from "../helpers/scenario-assertions.js";
import { assertPersistedSnapshots, continueAndStop, resendAndStop, sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@full PBE-099 全链路总审计", async ({ noobot, protocolCapture }, testInfo) => {
  await selectPlugins(noobot.page, ["harness"]);
  const first = await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "full audit initial send") });
  const continued = await continueAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    previous: first.send, prompt: uniquePrompt(testInfo, "full audit first continue") });
  const resent = await resendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    content: uniquePrompt(testInfo, "full audit resend no attachment") });
  const file = fixedAttachment("pbe-099.txt");
  const attachedResend = await resendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    content: uniquePrompt(testInfo, "full audit resend with attachment"), attachment: file });
  const attachedContinue = await continueAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    previous: attachedResend, prompt: uniquePrompt(testInfo, "continue with persisted attachment") });
  expect(attachedContinue.input.attachments).toEqual([]);
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);

  const commands = assertCommandChain(protocolCapture, noobot.sessionId);
  expect(new Set(commands.map((command) => command.commandId)).size).toBe(commands.length);
  expect(new Set(commands.filter((command) => command.identity?.turnScopeId)
    .map((command) => command.identity.turnScopeId)).size).toBeGreaterThanOrEqual(4);
  assertContinuation(first.send, continued);
  assertContinuation(attachedResend, attachedContinue);

  const events = lifecycleForSession(protocolCapture, noobot.sessionId);
  const terminalByTurn = new Map();
  for (const event of events.filter((item) => ["turn.completed", "turn.stop_completed", "turn.failed"].includes(item.eventType))) {
    terminalByTurn.set(event.turnScopeId, (terminalByTurn.get(event.turnScopeId) || 0) + 1);
  }
  expect([...terminalByTurn.values()].every((count) => count === 1)).toBe(true);
  expect(resent.identity.turnScopeId).not.toBe(first.send.identity.turnScopeId);
  expect(attachedResend.input.attachments).toHaveLength(1);
  await assertPersistedSnapshots(noobot.userId, noobot.sessionId, 5);
  assertNoForbiddenErrors(protocolCapture.console);
});
