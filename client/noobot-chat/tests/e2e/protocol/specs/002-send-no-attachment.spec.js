/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendMessage, waitForNaturalCompletion } from "../helpers/browser-actions.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { assertCommandChain, assertTurnLifecycle, waitForCommand } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import { findProtocolObjects } from "../helpers/websocket-capture.js";

test("@smoke PBE-002 连接、创建 Session 并完成无附件普通发送", async ({ noobot, protocolCapture }, testInfo) => {
  expect(noobot.sessionId).toBeTruthy();
  const received = findProtocolObjects(protocolCapture.websocketReceived);
  expect(received.some(({ event }) => event === "transport_ready")).toBe(true);
  await sendMessage(noobot.page, uniquePrompt(testInfo, "Do not call any tool. Reply with exactly: CASE002-OK"));
  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(command.input.attachments).toEqual([]);
  await waitForNaturalCompletion({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId, turnScopeId: command.identity.turnScopeId });
  assertCommandChain(protocolCapture, noobot.sessionId);
  assertTurnLifecycle(protocolCapture, noobot.sessionId, command.identity.turnScopeId);
  assertNoForbiddenErrors(protocolCapture.console);
});
