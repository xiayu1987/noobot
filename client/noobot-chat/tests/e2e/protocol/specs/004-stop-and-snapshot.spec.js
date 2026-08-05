/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { sendAndStop, assertPersistedSnapshots, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@smoke PBE-004 无附件运行中停止并保存快照", async ({ noobot, protocolCapture }, testInfo) => {
  const { send, stop } = await sendAndStop({
    page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "perform a long multi-step analysis"),
  });
  expect(stop.concurrency.expectedTurnRevision).toBeGreaterThanOrEqual(1);
  expect(stop.identity).toMatchObject(send.identity);
  const snapshots = await assertPersistedSnapshots(noobot.userId, noobot.sessionId, 1);
  expect(snapshots[0]).toMatchObject(send.identity);
  assertNoForbiddenErrors(protocolCapture.console);
});
