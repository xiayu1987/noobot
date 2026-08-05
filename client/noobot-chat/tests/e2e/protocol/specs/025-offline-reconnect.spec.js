/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendMessage, stopActiveTurn } from "../helpers/browser-actions.js";
import { cycleOffline } from "../helpers/reconnect-scenarios.js";
import { lifecycleForSession, waitForCommand, waitForLifecycle } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

test("@full PBE-025 断网重连后停止", async ({ noobot, protocolCapture }, testInfo) => {
  await sendMessage(noobot.page, uniquePrompt(testInfo, "long run while network cycles"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.processing_started", 0, send.identity.turnScopeId);
  await cycleOffline(noobot.page, protocolCapture);
  const premature = lifecycleForSession(protocolCapture, noobot.sessionId)
    .filter((event) => event.turnScopeId === send.identity.turnScopeId && ["turn.failed", "turn.stop_completed"].includes(event.eventType));
  expect(premature).toEqual([]);
  await stopActiveTurn(noobot.page);
  await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.stop_completed", 0, send.identity.turnScopeId);
});
