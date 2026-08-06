/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { fixedAttachment } from "../helpers/browser-actions.js";
import { sendAndStop, continueAndStop, assertPersistedSnapshots, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-007 带附件停止后继续", async ({ noobot, protocolCapture }, testInfo) => {
  const file = fixedAttachment("pbe-007.txt");
  const { send } = await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "read attachment and run long"), attachment: file });
  expect(send.input.attachments).toHaveLength(1);
  const continued = await continueAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    previous: send, prompt: uniquePrompt(testInfo, "continue using the original attachment") });
  expect(continued.input.attachments).toEqual([]);
  const snapshots = await assertPersistedSnapshots(noobot.userId, noobot.sessionId, 2);
  expect(snapshots).toEqual(expect.arrayContaining([
    expect.objectContaining(send.identity),
    expect.objectContaining(continued.identity),
  ]));
  snapshots.forEach((snapshot) => expect(JSON.stringify(snapshot)).toContain(file.name));
});
