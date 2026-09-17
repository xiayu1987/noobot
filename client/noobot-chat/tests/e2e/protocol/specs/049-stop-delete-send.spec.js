/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  deleteLatestUserMessage,
  sendMessage,
  stopActiveTurn,
} from "../helpers/browser-actions.js";
import { readSessionFact } from "../helpers/persistence-audit.js";
import {
  commandsForSession,
  lifecycleForSession,
  waitForCommand,
  waitForLifecycle,
} from "../helpers/scenario-assertions.js";
import { sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";

const ORPHANED_TERMINAL_ERROR = "terminal lifecycle is missing canonical messages";

test("@core PBE-049 停止并删除后可再次发送", async ({ noobot, protocolCapture }, testInfo) => {
  const { send: deletedTurn } = await sendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "stop before delete"),
  });

  await deleteLatestUserMessage(noobot.page);

  await expect
    .poll(async () => {
      const fact = await readSessionFact(noobot.userId, noobot.sessionId);
      return Object.keys(fact?.turnLifecycle?.turns || {});
    })
    .not.toContain(deletedTurn.identity.turnScopeId);

  const deletedFact = await readSessionFact(noobot.userId, noobot.sessionId);
  const orphanedTerminalScopes = Object.values(deletedFact?.turnLifecycle?.turns || {})
    .filter((turn) => turn?.terminalStatus)
    .map((turn) => String(turn.turnScopeId || ""))
    .filter(
      (turnScopeId) =>
        !(deletedFact?.turnOrder || []).some(
          (entry) => String(entry?.turnScopeId || "") === turnScopeId,
        ),
    );
  expect(orphanedTerminalScopes).toEqual([]);

  const commandOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, uniquePrompt(testInfo, "send after stopped turn deletion"));
  const nextSend = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.send",
    commandOffset,
  );
  expect(nextSend.identity.turnScopeId).not.toBe(deletedTurn.identity.turnScopeId);

  await expect
    .poll(() => {
      const event = lifecycleForSession(protocolCapture, noobot.sessionId).find(
        (item) =>
          item.turnScopeId === nextSend.identity.turnScopeId &&
          ["turn.processing_started", "turn.failed"].includes(item.eventType),
      );
      return event?.eventType || "";
    })
    .toBe("turn.processing_started");

  const failures = lifecycleForSession(protocolCapture, noobot.sessionId).filter(
    (item) => item.eventType === "turn.failed",
  );
  expect(JSON.stringify(failures)).not.toContain(ORPHANED_TERMINAL_ERROR);

  await stopActiveTurn(noobot.page);
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.stop_completed",
    0,
    nextSend.identity.turnScopeId,
  );
});
