/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export { AttachmentService } from "./service/attachment-service.js";
export { mergeAttachmentMetas, normalizeAttachmentMetas, mapAttachmentRecordsToMetas } from "./meta-ops.js";
export { appendAttachmentMetasToRuntimeAndTurn } from "./runtime-attachment.js";
export { readAttachIndex, writeAttachIndex } from "./index-manager.js";
export { validateAttachmentPolicy, resolveAttachmentPolicy, isMimeTypeAllowed, isExtensionAllowed } from "./policy/policy-validator.js";
export { getMimeTypeFromExtension, isValidMimeType } from "./policy/mime-utils.js";
export {
  DEFAULT_ATTACHMENT_SESSION_ID,
  DEFAULT_ATTACHMENT_SOURCE,
  DEFAULT_MIME_TYPE,
  MIME_TO_EXTENSION,
  ATTACHMENT_SOURCES,
  MAX_EXTENSION_LENGTH,
} from "./constants.js";
