/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * 兼容层（deprecated）：转发至语义化模块，保留旧引用路径可用。
 */

export {
  mergeAttachmentMetas,
  normalizeAttachmentMetas,
  mapAttachmentRecordsToMetas,
  normalizeAttachmentOwnerMeta,
  normalizeAttachmentParsedResultMeta,
  normalizeAttachmentTurnScopeMeta,
} from "./meta-ops.js";
export { appendAttachmentMetasToRuntimeAndTurn } from "./runtime-attachment.js";
