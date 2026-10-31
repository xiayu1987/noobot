/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendMessage, stopActiveTurn } from "../helpers/browser-actions.js";
import { cycleOffline } from "../helpers/reconnect-scenarios.js";
import {
  lifecycleForSession,
  waitForCommand,
  waitForLifecycle,
} from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import { waitForSessionExecutionEventTree } from "../helpers/persistence-audit.js";

test("@full PBE-025 断网重连后停止", async ({ noobot, protocolCapture }, testInfo) => {
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      "Call execute_script once with command `sleep 60`, foreground mode and low risk. Wait for its result before replying.",
    ),
  );
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    send.identity.turnScopeId,
  );
  await waitForSessionExecutionEventTree(noobot.userId, noobot.sessionId, (records) =>
    records.some(
      (record) =>
        record.turnScopeId === send.identity.turnScopeId &&
        record.event === "tool_call_start" &&
        record.data?.tool === "execute_script",
    ),
  );
  await cycleOffline(noobot.page, protocolCapture);
  const premature = lifecycleForSession(protocolCapture, noobot.sessionId).filter(
    (event) =>
      event.turnScopeId === send.identity.turnScopeId &&
      ["turn.completed", "turn.failed", "turn.stop_completed"].includes(event.eventType),
  );
  expect(premature).toEqual([]);
  await stopActiveTurn(noobot.page);
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.stop_completed",
    0,
    send.identity.turnScopeId,
  );
});
