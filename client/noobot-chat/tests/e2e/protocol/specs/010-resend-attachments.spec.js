/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { fixedAttachment } from "../helpers/browser-actions.js";
import { sendAndStop, resendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-010 保留原附件编辑重发", async ({ noobot, protocolCapture }, testInfo) => {
  const file = fixedAttachment("pbe-010.txt");
  await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "original attached"), attachment: file });
  const resend = await resendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    content: uniquePrompt(testInfo, "retain attachment") });
  expect(resend.input.attachments).toHaveLength(1);
  expect(resend.input.attachments[0].name).toBe(file.name);
});

test("@core PBE-011 删除原附件后重发", async ({ noobot, protocolCapture }, testInfo) => {
  const file = fixedAttachment("pbe-011.txt");
  await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "original attached"), attachment: file });
  const resend = await resendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    content: uniquePrompt(testInfo, "remove attachment"), removeAttachments: true });
  expect(resend.input.attachments).toEqual([]);
});

test("@core PBE-012 新增附件后重发", async ({ noobot, protocolCapture }, testInfo) => {
  await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "original without attachment") });
  const file = fixedAttachment("pbe-012.txt");
  const resend = await resendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    content: uniquePrompt(testInfo, "add attachment"), attachment: file });
  expect(resend.input.attachments).toHaveLength(1);
  expect(resend.input.attachments[0].name).toBe(file.name);
});
