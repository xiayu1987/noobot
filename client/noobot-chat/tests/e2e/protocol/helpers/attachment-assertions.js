/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { assertFileMutationResult } from "@noobot/file-mutation-protocol";
import { text } from "@noobot/shared/value";

export function assertUniqueAttachmentIds(attachments = []) {
  const ids = attachments.map((item) => item.attachmentId);
  for (const id of ids) expect(id).toBeTruthy();
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

export function mutationResultsForTurn(records = [], turnScopeId = "", toolName = "") {
  return records
    .filter(
      (record) =>
        record?.event === "tool_call_end" &&
        record?.turnScopeId === turnScopeId &&
        record?.data?.tool === toolName &&
        record?.data?.success === true,
    )
    .map((record) => ({
      record,
      result: assertFileMutationResult(
        typeof record.data.result === "object" && record.data.result !== null
          ? record.data.result
          : JSON.parse(String(record.data.result || "")),
      ),
    }));
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
  const authenticatedApiKey = text(apiKey);
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
    .map((name) => text(name))
    .filter(Boolean)
    .sort();
}
