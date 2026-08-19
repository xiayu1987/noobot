/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

export function assertCanonicalAttachment(actual, expected) {
  const identity = actual?.identity || actual;
  const descriptor = actual?.descriptor || actual;
  expect(descriptor).toMatchObject({
    name: expected.name,
    mimeType: expected.mimeType,
    size: expected.size,
    contentSha256: expected.contentSha256,
  });
  expect(identity.attachmentId).toBeTruthy();
}

export function assertUniqueAttachmentIds(attachments = []) {
  const ids = attachments.map((item) => (item?.identity || item).attachmentId);
  expect(new Set(ids).size).toBe(ids.length);
}

export function writeFileResultsForTurn(records = [], turnScopeId = "") {
  return records.filter(
    (record) =>
      record?.event === "tool_call_end" &&
      record?.turnScopeId === turnScopeId &&
      record?.data?.tool === "write_file" &&
      record?.data?.success === true,
  );
}

function transferAttachments(value = {}) {
  return (Array.isArray(value?.transferEnvelopes) ? value.transferEnvelopes : []).flatMap(
    (envelope) =>
      Array.isArray(envelope?.payload?.attachments) ? envelope.payload.attachments : [],
  );
}

export function transferAttachmentsForTurn(records = [], turnScopeId = "") {
  return records
    .filter((record) => record?.event === "tool_call_end" && record?.turnScopeId === turnScopeId)
    .flatMap((record) => transferAttachments(record.data));
}

export function persistedTransferAttachmentsForTurn(messages = [], turnScopeId = "") {
  return messages
    .filter((message) => message?.turnScopeId === turnScopeId)
    .flatMap((message) => (Array.isArray(message?.toolTimeline) ? message.toolTimeline : []))
    .filter((entry) => entry?.tool === "write_file" && entry?.status === "completed")
    .flatMap((entry) => transferAttachments(entry.resultEvent));
}

export function attachmentKeys(attachments = []) {
  return attachments
    .map((attachment) =>
      JSON.stringify([
        String(attachment?.identity?.attachmentId || ""),
        String(attachment?.descriptor?.name || attachment?.name || ""),
        String(attachment?.descriptor?.contentSha256 || attachment?.contentSha256 || ""),
      ]),
    )
    .sort();
}

export async function assertAttachmentHttpAccess(
  page,
  {
    apiKey = "",
    userId = "",
    sessionId = "",
    attachmentSource = "model",
    attachmentId = "",
    expectedName = "",
  } = {},
) {
  const authenticatedApiKey = String(apiKey || "").trim();
  expect(authenticatedApiKey).toBeTruthy();
  const url =
    `/api/internal/attachment/${encodeURIComponent(userId)}/${encodeURIComponent(attachmentId)}` +
    `?sessionId=${encodeURIComponent(sessionId)}&attachmentSource=${encodeURIComponent(attachmentSource)}`;
  const response = await page.request.get(url, {
    headers: { "x-api-key": authenticatedApiKey },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"] || "").toContain(
    encodeURIComponent(expectedName),
  );
  const body = await response.body();
  expect(body.length).toBeGreaterThan(0);
}

export async function readRenderedFileNames(
  page,
  { badgeClass = "", role = "", attachmentSource = "" } = {},
) {
  const cardSelector = role ? `.base-message-shell.${role} .base-file-card` : ".base-file-card";
  const sourceSelector = attachmentSource ? `[data-attachment-source="${attachmentSource}"]` : "";
  const selector = badgeClass
    ? `${cardSelector}${sourceSelector}:has(.attachment-owner-badge.${badgeClass}) .file-name`
    : `${cardSelector}${sourceSelector} .file-name`;
  return (await page.locator(selector).allTextContents())
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .sort();
}
