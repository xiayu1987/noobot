/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { sendAndStop, continueAndStop, assertPersistedSnapshots, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@smoke PBE-006 无附件停止后继续", async ({ noobot, protocolCapture }, testInfo) => {
  const { send } = await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "long first run") });
  const continued = await continueAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    previous: send, prompt: uniquePrompt(testInfo, "continue from the stopped context") });
  expect(continued.input.attachments).toEqual([]);
  await assertPersistedSnapshots(noobot.userId, noobot.sessionId, 2);
  assertNoForbiddenErrors(protocolCapture.console);
});
