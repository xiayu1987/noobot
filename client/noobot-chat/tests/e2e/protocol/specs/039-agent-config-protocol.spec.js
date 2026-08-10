/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { selectScenario, sendMessage, waitForNaturalCompletion } from "../helpers/browser-actions.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { waitForCommand } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-039 agent config protocol keeps selected scenario through a real turn", async ({ noobot, protocolCapture }, testInfo) => {
  await selectScenario(noobot.page, "programming");
  await sendMessage(noobot.page, uniquePrompt(testInfo, "Reply exactly CONFIG-PROTOCOL-OK without calling a tool"));

  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(command.preferences.scenario).toBe("programming");
  expect(command.preferences).not.toHaveProperty("scenarioProfile");
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
  });
  assertNoForbiddenErrors(protocolCapture.console);
});
