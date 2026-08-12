/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  selectScenario,
  sendMessage,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { waitForCommand } from "../helpers/scenario-assertions.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-041 selected agent config survives refresh and remains canonical for the next Turn", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  await selectScenario(noobot.page, "programming");
  await sendMessage(noobot.page, uniquePrompt(testInfo, "first config refresh turn"));
  const first = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(first.preferences.scenario).toBe("programming");
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: first.identity.turnScopeId,
  });

  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await sendMessage(noobot.page, uniquePrompt(testInfo, "second config refresh turn"));
  const commands = protocolCapture.websocketSent;
  const second = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send", 1);
  expect(second.preferences.scenario).toBe("programming");
  expect(second.identity.turnScopeId).not.toBe(first.identity.turnScopeId);
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: second.identity.turnScopeId,
  });
  expect(commands.length).toBeGreaterThan(0);
  assertNoForbiddenErrors(protocolCapture.console);
});
