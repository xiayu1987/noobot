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

test("@smoke PBE-002 无附件普通发送", async ({ noobot, protocolCapture }, testInfo) => {
  await sendMessage(noobot.page, uniquePrompt(testInfo, "reply briefly, but run long enough for Stop to appear"));
  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(command.input.attachments).toEqual([]);
  await waitForNaturalCompletion({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId, turnScopeId: command.identity.turnScopeId });
  assertCommandChain(protocolCapture, noobot.sessionId);
  assertTurnLifecycle(protocolCapture, noobot.sessionId, command.identity.turnScopeId);
  assertNoForbiddenErrors(protocolCapture.console);
});
