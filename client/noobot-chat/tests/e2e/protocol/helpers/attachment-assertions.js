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
  return records.filter((record) =>
    record?.event === "tool_call_end" &&
    record?.turnScopeId === turnScopeId &&
    record?.data?.tool === "write_file" &&
    record?.data?.success === true,
  );
}

export function persistedWriteFilesForTurn(messages = [], turnScopeId = "") {
  return messages
    .filter((message) => message?.turnScopeId === turnScopeId)
    .flatMap((message) => Array.isArray(message?.toolTimeline) ? message.toolTimeline : [])
    .filter((entry) => entry?.tool === "write_file" && entry?.status === "completed")
    .flatMap((entry) => Array.isArray(entry?.resultEvent?.writtenFiles)
      ? entry.resultEvent.writtenFiles
      : []);
}

export function writtenFileKeys(files = []) {
  return files.map((file) => JSON.stringify([
    String(file?.toolName || ""),
    String(file?.resolvedPath || ""),
    String(file?.fileName || ""),
    String(file?.sourceType || ""),
  ])).sort();
}

export async function readRenderedFileNames(page, { badgeClass = "", role = "", attachmentSource = "" } = {}) {
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
