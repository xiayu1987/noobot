/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { sendAndStop, continueAndStop, assertPersistedSnapshots, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@smoke PBE-006 无附件停止、保存快照后继续", async ({ noobot, protocolCapture }, testInfo) => {
  const { send, stop } = await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "long first run") });
  expect(stop.concurrency.expectedTurnRevision).toBeGreaterThanOrEqual(1);
  expect(stop.identity).toMatchObject(send.identity);
  const firstSnapshots = await assertPersistedSnapshots(noobot.userId, noobot.sessionId, 1);
  expect(firstSnapshots[0]).toMatchObject(send.identity);
  const continued = await continueAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    previous: send, prompt: uniquePrompt(testInfo, "continue from the stopped context") });
  expect(continued.input.attachments).toEqual([]);
  await assertPersistedSnapshots(noobot.userId, noobot.sessionId, 2);
  assertNoForbiddenErrors(protocolCapture.console);
});
