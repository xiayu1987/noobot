/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { ATTACHMENT_CATALOG } from "@noobot/attachment-protocol";
import { safeStr } from "../../shared/utils/shared-utils.js";

function encodeAttachmentScopeSegment(value, fieldName) {
  const segment = safeStr(value);
  if (!segment || segment === "." || segment === "..") {
    throw new TypeError(`Invalid attachment storage ${fieldName}`);
  }
  return encodeURIComponent(segment);
}

export function attachScopedRoot(basePath) {
  return path.join(basePath, WORKSPACE_LAYOUT.SCOPED_ATTACH_DIR);
}

export function attachSessionRoot(basePath, sessionId) {
  return path.join(
    attachScopedRoot(basePath),
    encodeAttachmentScopeSegment(sessionId, "sessionId"),
  );
}

export function attachScopeRoot(basePath, scope) {
  return path.join(
    attachSessionRoot(basePath, scope.sessionId),
    encodeAttachmentScopeSegment(scope.attachmentSource, "attachmentSource"),
  );
}

export function attachmentScopeIndexPath(basePath, scope) {
  return path.join(attachScopeRoot(basePath, scope), ATTACHMENT_CATALOG.file);
}

export function legacyAttachmentScopeIndexPath(basePath, scope) {
  return path.join(attachScopeRoot(basePath, scope), ATTACHMENT_CATALOG.legacyFile);
}

export function decodeAttachmentStorageSegment(name, fieldName) {
  const value = decodeURIComponent(name);
  if (encodeAttachmentScopeSegment(value, fieldName) !== name)
    throw new TypeError(`Invalid attachment storage ${fieldName}`);
  return value;
}
