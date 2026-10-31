/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";

import { MIME_TO_EXTENSION, MAX_EXTENSION_LENGTH } from "../constants.js";
import { normalizeAttachmentOwnerMeta, normalizeAttachmentTurnScopeMeta } from "../meta-ops.js";
import { safeStr } from "../../shared/utils/shared-utils.js";
import {
  fromPersistedAttachmentRecord,
  toPersistedAttachmentRecord,
} from "./persisted-record-adapter.js";

export function buildPublicRecord(basePath, record) {
  const owner = normalizeAttachmentOwnerMeta(record);
  const turnScope = normalizeAttachmentTurnScopeMeta(record, owner);
  const canonical = fromPersistedAttachmentRecord(
    basePath,
    toPersistedAttachmentRecord(basePath, { ...record, owner }),
  );
  return {
    ...canonical,
    ...(turnScope ? { turnScope } : {}),
  };
}

export function normalizeExtension(fileName, mimeType) {
  const fromName = path.extname(safeStr(fileName)).slice(0, MAX_EXTENSION_LENGTH);
  if (fromName) return fromName;
  return (MIME_TO_EXTENSION[safeStr(mimeType).toLowerCase()] || "").slice(0, MAX_EXTENSION_LENGTH);
}
