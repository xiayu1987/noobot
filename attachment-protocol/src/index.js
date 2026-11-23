/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export * from "./errors.js";
export * from "./protocol-utils.js";
export * from "./identity.js";
export { readRequiredAttachmentMetadata } from "./metadata-read.js";
export { assertAttachmentIngestInputs, assertAttachmentIngestResult } from "./ingest.js";
export * from "./model.js";
export * from "./persistence/record-v1.js";
export { parsePersistedAttachmentIndex } from "./persistence/index.js";
export {
  ATTACHMENT_CATALOG,
  ATTACHMENT_CATALOG_ERROR,
  requireAttachmentCatalogRecord,
} from "./persistence/catalog.js";
export * from "./lifecycle/index.js";
export * from "./collections/identity-set.js";
