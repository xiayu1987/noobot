/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

export function assertCanonicalAttachment(actual, expected) {
  expect(actual).toMatchObject({
    name: expected.name,
    mimeType: expected.mimeType,
    size: expected.size,
    contentSha256: expected.contentSha256,
  });
  expect(actual.attachmentId).toBeTruthy();
}

export function assertUniqueAttachmentIds(attachments = []) {
  const ids = attachments.map((item) => item.attachmentId);
  expect(new Set(ids).size).toBe(ids.length);
}
