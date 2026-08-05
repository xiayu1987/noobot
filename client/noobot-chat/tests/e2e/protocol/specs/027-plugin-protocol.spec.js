/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { addAttachment, fixedAttachment, selectPlugins } from "../helpers/browser-actions.js";
import {
  readUserAttachmentIndex,
  waitForPluginExecutionEvents,
  waitForPluginRuntimeEvents,
} from "../helpers/persistence-audit.js";
import { sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";

function assertActivationIdentity(record, command, sessionId) {
  expect(record.data.protocolVersion).toBe(2);
  expect(record.data.surface).toBe("agent");
  expect(record.sessionId).toBe(sessionId);
  expect(record.turnScopeId).toBe(command.identity.turnScopeId);
  expect(record.dialogProcessId).toBeTruthy();
  expect(record.data.sessionId).toBe(record.sessionId);
  expect(record.data.dialogProcessId).toBe(record.dialogProcessId);
  expect(record.data.turnScopeId).toBe(record.turnScopeId);
}

async function assertExecutionProjection(userId, sessionId, command, pluginIds) {
  const events = await waitForPluginExecutionEvents(userId, sessionId, (records) =>
    pluginIds.every((pluginId) => records.some((record) =>
      record.event === "plugin.activated" &&
      record.data?.pluginId === pluginId &&
      record.turnScopeId === command.identity.turnScopeId,
    )),
  );
  for (const pluginId of pluginIds) {
    const record = events.find((item) =>
      item.event === "plugin.activated" && item.data?.pluginId === pluginId,
    );
    assertActivationIdentity(record, command, sessionId);
  }
}

test("@core PBE-027 Manifest V2 激活与 runtime-events 身份闭环", async ({ noobot, protocolCapture }, testInfo) => {
  await selectPlugins(noobot.page, ["harness"]);
  const { send } = await sendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "plugin protocol lifecycle audit"),
  });
  const events = await waitForPluginRuntimeEvents(noobot.userId, noobot.sessionId, (records) =>
    ["plugin.activated", "plugin.contribution_committed"].every((event) =>
      records.some((record) => record.event === event && record.data?.pluginId === "harness" && record.turnScopeId === send.identity.turnScopeId),
    ),
  );
  for (const eventName of ["plugin.activated", "plugin.contribution_committed"]) {
    const record = events.find((item) => item.event === eventName && item.data?.pluginId === "harness" && item.turnScopeId === send.identity.turnScopeId);
    assertActivationIdentity(record, send, noobot.sessionId);
  }
  await assertExecutionProjection(noobot.userId, noobot.sessionId, send, ["harness"]);
});

test("@full PBE-028 Workflow + Harness 带附件遵循同一插件协议", async ({ noobot, protocolCapture }, testInfo) => {
  await selectPlugins(noobot.page, ["workflow", "harness"]);
  await addAttachment(noobot.page, fixedAttachment("pbe-028.txt"));
  const { send } = await sendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "workflow and harness protocol audit"),
  });
  expect(send.input.attachments).toHaveLength(1);
  const events = await waitForPluginRuntimeEvents(noobot.userId, noobot.sessionId, (records) =>
    ["harness", "workflow"].every((pluginId) => records.some((record) =>
      record.event === "plugin.activated" && record.data?.pluginId === pluginId && record.turnScopeId === send.identity.turnScopeId,
    )),
  );
  for (const pluginId of ["harness", "workflow"]) {
    const record = events.find((item) => item.event === "plugin.activated" && item.data?.pluginId === pluginId && item.turnScopeId === send.identity.turnScopeId);
    assertActivationIdentity(record, send, noobot.sessionId);
  }
  await assertExecutionProjection(noobot.userId, noobot.sessionId, send, ["harness", "workflow"]);

  const attachmentIndex = await readUserAttachmentIndex(noobot.userId, noobot.sessionId);
  expect(attachmentIndex.sessionId).toBe(noobot.sessionId);
  expect(attachmentIndex.attachmentSource).toBe("user");
  const attachments = Object.values(attachmentIndex.attachments || {});
  expect(attachments).toHaveLength(1);
  expect(attachments[0]).toMatchObject({
    name: "pbe-028.txt",
    sessionId: noobot.sessionId,
    attachmentSource: "user",
    generatedByModel: false,
  });
});
