/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { addAttachment, fixedAttachment, sendMessage, waitForNaturalCompletion } from "../helpers/browser-actions.js";
import { assertTurnLifecycle, waitForCommand } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-003 带附件普通发送", async ({ noobot, protocolCapture }, testInfo) => {
  const file = fixedAttachment("pbe-003.txt");
  await addAttachment(noobot.page, file);
  await sendMessage(noobot.page, uniquePrompt(testInfo, "read the attached file and state its exact content"));
  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(command.input.attachments).toHaveLength(1);
  expect(command.input.attachments[0]).toMatchObject({
    name: file.name,
    mimeType: file.mimeType,
    contentBase64: file.buffer.toString("base64"),
  });
  await waitForNaturalCompletion(noobot.page);
  assertTurnLifecycle(protocolCapture, noobot.sessionId, command.identity.turnScopeId);
});
