/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * 兼容层：转发至新语义模块，保持旧引用路径可用。
 */

export { mergeAttachmentMetas, normalizeAttachmentMetas, mapAttachmentRecordsToMetas } from "./meta-ops.js";
export { appendAttachmentMetasToRuntimeAndTurn } from "./runtime-attachment.js";
