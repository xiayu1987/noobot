/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendAndStop, continueAndStop, assertPersistedSnapshots, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-008 连续三次停止和继续", async ({ noobot, protocolCapture }, testInfo) => {
  const { send } = await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "run zero") });
  const runs = [send];
  for (let index = 1; index <= 3; index += 1) {
    runs.push(await continueAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
      previous: runs.at(-1), prompt: uniquePrompt(testInfo, `continue run ${index}`) }));
  }
  expect(new Set(runs.map((run) => run.identity.turnScopeId)).size).toBe(4);
  await assertPersistedSnapshots(noobot.userId, noobot.sessionId, 4);
});
