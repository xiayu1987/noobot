/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { PLUGIN_PROTOCOL_VERSION } from "@noobot/plugin-protocol";
import {
  assertAttachmentHttpAccess,
  assertUniqueAttachmentIds,
  readRenderedFileNames,
  transferAttachmentsForTurn,
} from "../helpers/attachment-assertions.js";
import {
  addAttachment,
  fixedAttachment,
  fixedPngAttachment,
  selectPlugins,
  sendMessage,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import {
  readAttachmentIndex,
  readSessionExecutionEventTree,
  waitForSessionExecutionEventTree,
  waitForModelInvocationTraces,
  waitForPluginExecutionEvents,
  waitForPluginRuntimeEvents,
} from "../helpers/persistence-audit.js";
import { waitForCommand } from "../helpers/scenario-assertions.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { isMainAgentModelInvocation } from "../helpers/model-message-assertions.js";

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
    pluginIds.every((pluginId) =>
      records.some(
        (record) =>
          record.event === "plugin.activated" &&
          record.data?.pluginId === pluginId &&
          record.turnScopeId === command.identity.turnScopeId,
      ),
    ),
  );
  for (const pluginId of pluginIds) {
    const record = events.find(
      (item) => item.event === "plugin.activated" && item.data?.pluginId === pluginId,
    );
    assertActivationIdentity(record, command, sessionId);
  }
}

test("@core PBE-027 Manifest V2 激活与 runtime-events 身份闭环", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  await selectPlugins(noobot.page, ["harness"]);
  const { send } = await sendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "plugin protocol lifecycle audit"),
  });
  const events = await waitForPluginRuntimeEvents(noobot.userId, noobot.sessionId, (records) =>
    ["plugin.activated", "plugin.contribution_committed"].every((event) =>
      records.some(
        (record) =>
          record.event === event &&
          record.data?.pluginId === "harness" &&
          record.turnScopeId === send.identity.turnScopeId,
      ),
    ),
  );
  for (const eventName of ["plugin.activated", "plugin.contribution_committed"]) {
    const record = events.find(
      (item) =>
        item.event === eventName &&
        item.data?.pluginId === "harness" &&
        item.turnScopeId === send.identity.turnScopeId,
    );
    assertActivationIdentity(record, send, noobot.sessionId);
  }
  await assertExecutionProjection(noobot.userId, noobot.sessionId, send, ["harness"]);
});

test("@full PBE-028 Workflow + Harness 带附件遵循同一插件协议", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(420000);
  await selectPlugins(noobot.page, ["workflow", "harness"]);
  const file = fixedAttachment("pbe-028.txt");
  const childFilePath = `runtime/ops_workdir/pbe-028-child-${Date.now()}.txt`;
  await addAttachment(noobot.page, file);
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      `execute one workflow child that first calls write_file exactly once for ${childFilePath} with content PBE028-CHILD-FILE and overwrite=true, riskLevel=low, then reads the attached file with read_file riskLevel=low and reports both exact contents`,
    ),
  );
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: send.identity.turnScopeId,
    timeoutMs: 420000,
  });
  expect(send.input.attachments).toHaveLength(1);
  const events = await waitForPluginRuntimeEvents(noobot.userId, noobot.sessionId, (records) =>
    ["harness", "workflow"].every((pluginId) =>
      records.some(
        (record) =>
          record.event === "plugin.activated" &&
          record.data?.pluginId === pluginId &&
          record.turnScopeId === send.identity.turnScopeId,
      ),
    ),
  );
  for (const pluginId of ["harness", "workflow"]) {
    const record = events.find(
      (item) =>
        item.event === "plugin.activated" &&
        item.data?.pluginId === pluginId &&
        item.turnScopeId === send.identity.turnScopeId,
    );
    assertActivationIdentity(record, send, noobot.sessionId);
  }
  await assertExecutionProjection(noobot.userId, noobot.sessionId, send, ["harness", "workflow"]);

  const attachmentIndex = await readAttachmentIndex(noobot.userId, noobot.sessionId, "user");
  expect(attachmentIndex.sessionId).toBe(noobot.sessionId);
  expect(attachmentIndex.attachmentSource).toBe("user");
  const attachments = Object.values(attachmentIndex.attachments || {});
  expect(attachments).toHaveLength(1);
  expect(attachments[0]).toMatchObject({
    identity: {
      sessionId: noobot.sessionId,
      attachmentSource: "user",
    },
    descriptor: {
      name: file.name,
    },
  });
  expect(attachments[0].descriptor.generatedByModel).not.toBe(true);

  const traces = await waitForModelInvocationTraces(noobot.userId, noobot.sessionId, (records) =>
    records.some(
      (record) => record.parentSessionId === noobot.sessionId && isMainAgentModelInvocation(record),
    ),
  );
  const childCandidates = traces
    .filter(
      (record) => record.parentSessionId === noobot.sessionId && isMainAgentModelInvocation(record),
    )
    .map((record) => record.sessionId)
    .filter((sessionId, index, values) => sessionId && values.indexOf(sessionId) === index);
  const childSessionId = (
    await Promise.all(
      childCandidates.map(async (candidate) => {
        const execution = await readSessionExecutionEventTree(noobot.userId, candidate, {
          rootSessionId: noobot.sessionId,
        });
        return execution.some(
          (record) =>
            record.sessionId === candidate &&
            record.event === "tool_call_end" &&
            record.data?.tool === "write_file" &&
            record.data?.success === true,
        )
          ? candidate
          : "";
      }),
    )
  ).find(Boolean);
  expect(childSessionId).toBeTruthy();
  const childExecution = await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (records) =>
      records.some(
        (record) =>
          record.sessionId === childSessionId &&
          record.event === "tool_call_end" &&
          record.data?.tool === "write_file" &&
          record.data?.success === true,
      ),
  );
  const childWriteResults = childExecution.filter(
    (record) =>
      record.sessionId === childSessionId &&
      record.event === "tool_call_end" &&
      record.data?.tool === "write_file" &&
      record.data?.success === true,
  );
  expect(childWriteResults).toHaveLength(1);
  const childWrittenAttachments = transferAttachmentsForTurn(
    childWriteResults,
    childWriteResults[0].turnScopeId,
  );
  expect(childWrittenAttachments).toHaveLength(1);
  const childAttachmentIndex = await readAttachmentIndex(noobot.userId, childSessionId, "model");
  expect(childAttachmentIndex).toMatchObject({
    sessionId: childSessionId,
    attachmentSource: "model",
  });
  const childAttachments = Object.values(childAttachmentIndex.attachments || {});
  expect(childAttachments).toHaveLength(1);
  expect(childAttachments[0]).toMatchObject({
    identity: {
      sessionId: childSessionId,
      attachmentSource: "model",
    },
    descriptor: {
      name: childFilePath.split("/").pop(),
      generatedByModel: true,
      generationSource: "write_file_output",
    },
  });
  expect(childAttachments[0].identity.attachmentId).not.toBe(attachments[0].identity.attachmentId);

  await expect
    .poll(() => readAttachmentIndex(noobot.userId, noobot.sessionId, "model"), { timeout: 30000 })
    .toMatchObject({ sessionId: noobot.sessionId, attachmentSource: "model" });
  const modelIndex = await readAttachmentIndex(noobot.userId, noobot.sessionId, "model");
  const generatedAttachments = Object.values(modelIndex.attachments || {});
  expect(generatedAttachments.length).toBeGreaterThanOrEqual(2);
  assertUniqueAttachmentIds(generatedAttachments);
  expect(
    generatedAttachments.every(
      (item) =>
        item.identity?.attachmentSource === "model" && item.descriptor?.generatedByModel === true,
    ),
  ).toBe(true);
  expect(
    generatedAttachments.some(
      (item) => item.descriptor?.generationSource === "workflow_node_agent_result",
    ),
  ).toBe(true);
  expect(
    generatedAttachments.some(
      (item) => item.descriptor?.generationSource === "workflow_completed_attachment_summary",
    ),
  ).toBe(true);

  // The same session also proves that ordinary harness guidance is not an attachment flow.
  const executionEvents = await readSessionExecutionEventTree(noobot.userId, noobot.sessionId);
  const envelopes = executionEvents.flatMap((record) =>
    Array.isArray(record?.data?.transferEnvelopes) ? record.data.transferEnvelopes : [],
  );
  expect(
    Object.values(modelIndex.attachments || {}).some((item) =>
      String(item?.descriptor?.name || item?.name || "").startsWith("harness-guidance-"),
    ),
  ).toBe(false);
  expect(
    envelopes.some(
      (envelope) =>
        envelope?.intent?.scenario === "harness" &&
        envelope?.intent?.strategy === "harness_summary" &&
        envelope?.intent?.reason === "guidance",
    ),
  ).toBe(false);

  for (const attachment of generatedAttachments) {
    await assertAttachmentHttpAccess(noobot.page, {
      userId: noobot.userId,
      sessionId: noobot.sessionId,
      attachmentSource: "model",
      attachmentId: attachment.identity.attachmentId,
      expectedName: attachment.descriptor.name,
    });
  }

  const generatedNames = generatedAttachments.map((item) => item.descriptor?.name).sort();
  await expect
    .poll(
      () => readRenderedFileNames(noobot.page, { role: "assistant", attachmentSource: "model" }),
      { timeout: 30000 },
    )
    .toEqual(generatedNames);
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await expect
    .poll(
      () => readRenderedFileNames(noobot.page, { role: "assistant", attachmentSource: "model" }),
      { timeout: 30000 },
    )
    .toEqual(generatedNames);
  assertNoForbiddenErrors(protocolCapture.console);
});

test("@full PBE-038 用户附件解析结果保持 canonical identity 并可预览下载", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(240000);
  const file = fixedPngAttachment("pbe-038-source.png");
  await addAttachment(noobot.page, file);
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      "调用 media2data 解析用户上传的 pbe-038-source.png，并报告解析结果文件名",
    ),
  );
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  const userCard = noobot.page
    .locator(`.base-message-shell.user .base-file-card`)
    .filter({ hasText: file.name })
    .last();
  await expect(userCard).toBeVisible();
  await expect(noobot.page.locator(".stop-float-btn")).toBeVisible();
  await expect
    .poll(() => userCard.locator(".parsed-result-action").count(), { timeout: 120000 })
    .toBe(2);
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: send.identity.turnScopeId,
    timeoutMs: 240000,
  });

  await expect
    .poll(() => readAttachmentIndex(noobot.userId, noobot.sessionId, "user"), { timeout: 30000 })
    .toMatchObject({ sessionId: noobot.sessionId, attachmentSource: "user" });
  const sourceIndex = await readAttachmentIndex(noobot.userId, noobot.sessionId, "user");
  const source = Object.values(sourceIndex.attachments || {}).find(
    (item) => item?.descriptor?.name === file.name || item?.name === file.name,
  );
  expect(source).toBeTruthy();
  const parsedResult = source.parsedResult || {
    ...(source.parsedResultRef || {}),
    ...(source.parsedResultRef?.identity || {}),
  };
  expect(parsedResult).toMatchObject({
    attachmentId: expect.any(String),
    sessionId: expect.any(String),
    attachmentSource: "model",
  });
  await assertAttachmentHttpAccess(noobot.page, {
    userId: noobot.userId,
    sessionId: parsedResult.sessionId,
    attachmentSource: parsedResult.attachmentSource,
    attachmentId: parsedResult.attachmentId,
    expectedName: parsedResult.name || `${source.identity?.attachmentId || source.attachmentId}.md`,
  });

  await expect(userCard.locator(".parsed-result-action")).toHaveCount(2);
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  const refreshedCard = noobot.page
    .locator(`.base-message-shell.user .base-file-card`)
    .filter({ hasText: file.name })
    .last();
  await expect(refreshedCard).toBeVisible();
  await expect(refreshedCard.locator(".parsed-result-action")).toHaveCount(2);
});
