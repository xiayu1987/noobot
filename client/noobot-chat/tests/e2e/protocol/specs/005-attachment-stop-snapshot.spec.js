/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { fixedAttachment } from "../helpers/browser-actions.js";
import { sendAndStop, assertPersistedSnapshots, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-005 带附件停止快照", async ({ noobot, protocolCapture }, testInfo) => {
  const file = fixedAttachment("pbe-005.txt");
  const { send } = await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "read attachment then perform long analysis"), attachment: file });
  expect(send.input.attachments).toHaveLength(1);
  const [snapshot] = await assertPersistedSnapshots(noobot.userId, noobot.sessionId, 1);
  expect(JSON.stringify(snapshot)).toContain(file.name);
  expect(snapshot).toMatchObject(send.identity);
});
