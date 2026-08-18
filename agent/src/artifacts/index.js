/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export { AttachmentService } from "./service/attachment-service.js";
export {
  normalizeAttachmentMetas,
  mapAttachmentRecordsToMetas,
  normalizeAttachmentOwnerMeta,
  normalizeAttachmentTurnScopeMeta,
  projectCanonicalAttachmentIdentity,
  projectCanonicalAttachmentIdentities,
  canonicalAttachmentIdentityKey,
  assertCanonicalAttachments,
} from "./meta-ops.js";
export { resolveCanonicalSourceAttachment } from "./source-attachment-resolver.js";
export {
  applyRuntimeUserMessageAttachments,
  resolveRuntimeUserMessageAttachments,
  runtimeHasExplicitUserMessageAttachments,
  updateRuntimeUserMessageAttachment,
} from "./runtime-user-message-attachments.js";
export { readAttachIndex, writeAttachIndex } from "./index-manager.js";
export {
  validateAttachmentPolicy,
  resolveAttachmentPolicy,
  isMimeTypeAllowed,
  isExtensionAllowed,
} from "./policy/policy-validator.js";
export { getMimeTypeFromExtension, isValidMimeType } from "./policy/mime-utils.js";
export {
  DEFAULT_MIME_TYPE,
  MIME_TO_EXTENSION,
  VALID_ATTACHMENT_SOURCES,
  MAX_EXTENSION_LENGTH,
} from "./constants.js";
