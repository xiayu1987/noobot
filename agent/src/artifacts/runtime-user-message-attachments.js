/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text, isObjectLike } from "@noobot/shared/value";

function cloneAttachmentList(value) {
  return Array.isArray(value) ? value : [];
}

function resolveRuntimeUserMessageAttachments(runtime = {}) {
  if (!isObjectLike(runtime)) return [];
  if (Array.isArray(runtime.userMessageAttachments)) {
    return runtime.userMessageAttachments;
  }
  return [];
}

export function runtimeHasExplicitUserMessageAttachments(runtime = {}) {
  return Boolean(
    runtime && typeof runtime === "object" && Array.isArray(runtime.userMessageAttachments),
  );
}

export function applyRuntimeUserMessageAttachments(runtime = {}, attachments = []) {
  if (!isObjectLike(runtime)) return runtime;
  const canonicalAttachments = cloneAttachmentList(attachments);
  runtime.userMessageAttachments = canonicalAttachments;
  return runtime;
}

export function updateRuntimeUserMessageAttachment(runtime = {}, attachmentId = "", update = {}) {
  if (!isObjectLike(runtime)) return false;
  const normalizedAttachmentId = text(attachmentId);
  if (!normalizedAttachmentId || !isObjectLike(update)) return false;

  const sourceAttachments = resolveRuntimeUserMessageAttachments(runtime);
  const sourceAttachmentIndex = sourceAttachments.findIndex(
    (item) => text(item?.attachmentId) === normalizedAttachmentId,
  );
  if (sourceAttachmentIndex < 0) return false;

  const nextAttachments = sourceAttachments.slice();
  nextAttachments[sourceAttachmentIndex] = {
    ...(nextAttachments[sourceAttachmentIndex] || {}),
    ...update,
  };
  applyRuntimeUserMessageAttachments(runtime, nextAttachments);
  return true;
}
