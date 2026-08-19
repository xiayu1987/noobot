/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";
import { safeStr } from "../../shared/utils/shared-utils.js";

export function encodeAttachmentScopeSegment(value, fieldName) {
  const segment = safeStr(value);
  if (!segment) throw new TypeError(`${fieldName} is required`);
  return encodeURIComponent(segment);
}

export function decodeAttachmentScopeSegment(value, fieldName) {
  const encoded = safeStr(value);
  if (!encoded) throw new TypeError(`${fieldName} is required`);
  let decoded;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new TypeError(`${fieldName} has invalid encoding`);
  }
  if (encodeAttachmentScopeSegment(decoded, fieldName) !== encoded) {
    throw new TypeError(`${fieldName} is not canonically encoded`);
  }
  return decoded;
}

export function attachScopedRoot(basePath) {
  return path.join(basePath, "runtime/attach/scoped");
}

export function attachScopeRoot(basePath, scope) {
  return path.join(
    attachScopedRoot(basePath),
    encodeAttachmentScopeSegment(scope.sessionId, "sessionId"),
    encodeAttachmentScopeSegment(scope.attachmentSource, "attachmentSource"),
  );
}

export function attachmentScopeIndexPath(basePath, scope) {
  return path.join(attachScopeRoot(basePath, scope), "attachments.json");
}
