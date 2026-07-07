/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Runtime attachment field adapter.
 *
 * Canonical rule:
 * - runtime.userMessageAttachments is the current user turn's authoritative
 *   attachment collection for model user-meta and session user-message writes.
 * - runtime.attachments is the ordinary runtime/tool-generated attachment
 *   bucket and must not be used as a user-message fact source when the
 *   canonical field is present.
 */

function cloneAttachmentList(value) {
  return Array.isArray(value) ? value : [];
}

export function resolveRuntimeUserMessageAttachments(runtime = {}) {
  if (!runtime || typeof runtime !== "object") return [];
  if (Array.isArray(runtime.userMessageAttachments)) {
    return runtime.userMessageAttachments;
  }
  return [];
}

export function runtimeHasExplicitUserMessageAttachments(runtime = {}) {
  return Boolean(runtime && typeof runtime === "object" && Array.isArray(runtime.userMessageAttachments));
}

export function applyRuntimeUserMessageAttachments(runtime = {}, attachments = []) {
  if (!runtime || typeof runtime !== "object") return runtime;
  const canonicalAttachments = cloneAttachmentList(attachments);
  runtime.userMessageAttachments = canonicalAttachments;
  return runtime;
}

export function updateRuntimeUserMessageAttachment(runtime = {}, attachmentId = "", update = {}) {
  if (!runtime || typeof runtime !== "object") return false;
  const normalizedAttachmentId = String(attachmentId || "").trim();
  if (!normalizedAttachmentId || !update || typeof update !== "object") return false;

  const sourceAttachments = resolveRuntimeUserMessageAttachments(runtime);
  const sourceAttachmentIndex = sourceAttachments.findIndex(
    (item) => String(item?.attachmentId || "").trim() === normalizedAttachmentId,
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
