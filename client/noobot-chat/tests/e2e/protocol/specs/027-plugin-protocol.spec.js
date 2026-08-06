/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { PLUGIN_PROTOCOL_VERSION } from "@noobot/plugin-protocol";
import {
  addAttachment, fixedAttachment, selectPlugins, sendMessage, waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import {
  readUserAttachmentIndex,
  waitForModelInvocationTraces,
  waitForPluginExecutionEvents,
  waitForPluginRuntimeEvents,
} from "../helpers/persistence-audit.js";
import { waitForCommand } from "../helpers/scenario-assertions.js";
import { sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";

function assertActivationIdentity(record, command, sessionId) {
  expect(record.data.protocolVersion).toBe(PLUGIN_PROTOCOL_VERSION);
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
  test.setTimeout(420000);
  await selectPlugins(noobot.page, ["workflow", "harness"]);
  const file = fixedAttachment("pbe-028.txt");
  await addAttachment(noobot.page, file);
  await sendMessage(noobot.page, uniquePrompt(
    testInfo,
    "execute one workflow child that reads the attached file with read_file riskLevel=low and reports its exact content",
  ));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: send.identity.turnScopeId,
    timeoutMs: 300000,
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
    name: file.name,
    sessionId: noobot.sessionId,
    attachmentSource: "user",
    generatedByModel: false,
  });

  const traces = await waitForModelInvocationTraces(noobot.userId, noobot.sessionId, (records) =>
    records.some((record) => record.parentSessionId === noobot.sessionId),
  );
  const childSessionId = traces.find((record) => record.parentSessionId === noobot.sessionId)?.sessionId;
  expect(childSessionId).toBeTruthy();
  const childAttachmentIndex = await readUserAttachmentIndex(noobot.userId, childSessionId);
  expect(childAttachmentIndex).toMatchObject({
    sessionId: childSessionId,
    attachmentSource: "user",
  });
  const childAttachments = Object.values(childAttachmentIndex.attachments || {});
  expect(childAttachments).toHaveLength(1);
  expect(childAttachments[0]).toMatchObject({
    name: file.name,
    sessionId: childSessionId,
    attachmentSource: "user",
    generatedByModel: false,
  });
  expect(childAttachments[0].attachmentId).not.toBe(attachments[0].attachmentId);
});
