/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { fixedAttachment, selectPlugins } from "../helpers/browser-actions.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import {
  readSessionExecutionEvents,
  readSessionFact,
  readSessionRuntimeEvents,
} from "../helpers/persistence-audit.js";
import { assertCommandChain, lifecycleForSession } from "../helpers/scenario-assertions.js";
import {
  assertNoLegacySessionProtocolKeys,
  assertResendReplacementIdentityChain,
} from "../helpers/session-assertions.js";
import {
  assertPersistedSnapshots,
  continueAndStop,
  resendAndStop,
  sendAndStop,
  uniquePrompt,
} from "../helpers/turn-scenarios.js";

test("@core PBE-029 统一 Session 协议闭环审计", async ({ noobot, protocolCapture }, testInfo) => {
  await selectPlugins(noobot.page, ["harness"]);

  const first = await sendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "canonical send without attachment"),
  });
  const continued = await continueAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    previous: first.send,
    prompt: uniquePrompt(testInfo, "canonical continue"),
  });
  const resent = await resendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    content: uniquePrompt(testInfo, "canonical resend without attachment"),
  });
  const attached = await resendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    content: uniquePrompt(testInfo, "canonical resend with attachment"),
    attachment: fixedAttachment("pbe-029.txt"),
  });
  const removed = await resendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    content: uniquePrompt(testInfo, "canonical resend with explicit attachment removal"),
    removeAttachments: true,
  });

  expect(continued.identity.turnScopeId).not.toBe(first.send.identity.turnScopeId);
  expect(resent.input.attachments).toEqual([]);
  expect(attached.input.attachments).toHaveLength(1);
  expect(removed.input.attachments).toEqual([]);

  const commands = assertCommandChain(protocolCapture, noobot.sessionId);
  assertNoLegacySessionProtocolKeys(commands);
  const runCommands = commands.filter((command) =>
    ["turn.send", "turn.continue", "turn.resend"].includes(command.commandType));
  const aggregateVersions = runCommands.map((command) => command.concurrency.expectedAggregateVersion);
  expect(aggregateVersions.every(Number.isSafeInteger)).toBe(true);
  for (let index = 1; index < aggregateVersions.length; index += 1) {
    expect(aggregateVersions[index]).toBeGreaterThan(aggregateVersions[index - 1]);
  }

  const lifecycle = lifecycleForSession(protocolCapture, noobot.sessionId);
  assertNoLegacySessionProtocolKeys(lifecycle);
  const terminalCounts = new Map();
  for (const event of lifecycle.filter((item) =>
    ["turn.completed", "turn.stop_completed", "turn.failed"].includes(item.eventType))) {
    terminalCounts.set(event.turnScopeId, (terminalCounts.get(event.turnScopeId) || 0) + 1);
  }
  expect([...terminalCounts.values()].every((count) => count === 1)).toBe(true);

  await expect.poll(
    () => readSessionFact(noobot.userId, noobot.sessionId),
    { timeout: 15_000 },
  ).toMatchObject({ sessionId: noobot.sessionId, schemaVersion: 5 });

  const persisted = await readSessionFact(noobot.userId, noobot.sessionId);
  expect(Number.isSafeInteger(persisted.aggregateVersion)).toBe(true);
  expect(persisted.aggregateVersion).toBeGreaterThanOrEqual(5);
  expect("messages" in persisted).toBe(false);
  expect(new Set(persisted.turnOrder.map((turn) => turn.turnScopeId)).size).toBe(persisted.turnOrder.length);
  expect(new Set(persisted.messageOrder.map((message) => message.messageUid)).size).toBe(persisted.messageOrder.length);
  assertResendReplacementIdentityChain(commands, persisted);
  assertNoLegacySessionProtocolKeys(persisted);

  const [runtimeEvents, executionEvents, snapshots] = await Promise.all([
    readSessionRuntimeEvents(noobot.userId, noobot.sessionId),
    readSessionExecutionEvents(noobot.userId, noobot.sessionId),
    assertPersistedSnapshots(noobot.userId, noobot.sessionId, 5),
  ]);
  expect(runtimeEvents.length).toBeGreaterThan(0);
  expect(executionEvents.length).toBeGreaterThan(0);
  assertNoLegacySessionProtocolKeys(runtimeEvents);
  assertNoLegacySessionProtocolKeys(executionEvents);
  assertNoLegacySessionProtocolKeys(snapshots);

  expect(protocolCapture.httpRequests
    .filter((request) => /terminal/i.test(request.url))
    .every((request) => !new URL(request.url).searchParams.has("persistenceScope"))).toBe(true);
  assertNoForbiddenErrors(protocolCapture.console);
});
