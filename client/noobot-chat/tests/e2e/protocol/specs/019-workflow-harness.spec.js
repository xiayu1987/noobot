/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { fixedAttachment, selectPlugins, sendMessage, addAttachment, waitForNaturalCompletion } from "../helpers/browser-actions.js";
import { lifecycleForSession, waitForCommand } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

test("@full PBE-019 Workflow + Harness 联合运行", async ({ noobot, protocolCapture }, testInfo) => {
  await selectPlugins(noobot.page, ["workflow", "harness"]);
  await sendMessage(noobot.page, uniquePrompt(testInfo, "execute a workflow with at least one child task"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(new Set(send.preferences.selectedPlugins)).toEqual(new Set(["workflow", "harness"]));
  await waitForNaturalCompletion(noobot.page);
  const events = lifecycleForSession(protocolCapture, noobot.sessionId).filter((event) => event.turnScopeId === send.identity.turnScopeId);
  expect(events.some((event) => event.executionId)).toBe(true);
  expect(events.at(-1).eventType).toBe("turn.completed");
});

test("@full PBE-020 Workflow 带附件", async ({ noobot, protocolCapture }, testInfo) => {
  await selectPlugins(noobot.page, ["workflow", "harness"]);
  const file = fixedAttachment("pbe-020.txt");
  await addAttachment(noobot.page, file);
  await sendMessage(noobot.page, uniquePrompt(testInfo, "workflow child must read the attachment"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(send.input.attachments).toHaveLength(1);
  expect(send.input.attachments[0].name).toBe(file.name);
  await waitForNaturalCompletion(noobot.page);
});
