/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { findReplaceTurnExchanges } from "../helpers/http-capture.js";
import { sendAndStop, resendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-009 无附件编辑重发", async ({ noobot, protocolCapture }, testInfo) => {
  const { send } = await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "original message") });
  const resend = await resendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    content: uniquePrompt(testInfo, "edited replacement") });
  expect(resend.input.attachments).toEqual([]);
  expect(resend.identity.turnScopeId).not.toBe(send.identity.turnScopeId);
  expect(findReplaceTurnExchanges(protocolCapture)).toHaveLength(1);
});
