/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AttachmentProtocolError } from "./errors.js";
import { projectAttachmentIdentity } from "./identity.js";

export function assertAttachmentIngestInputs(inputs) {
  if (!Array.isArray(inputs)) {
    throw new AttachmentProtocolError("attachment_ingest_arrays_required");
  }
  return inputs;
}

export function assertAttachmentIngestResult(inputs, records) {
  assertAttachmentIngestInputs(inputs);
  assertAttachmentIngestInputs(records);
  if (inputs.length !== records.length) {
    throw new AttachmentProtocolError("attachment_ingest_result_count_mismatch");
  }
  for (const record of records) projectAttachmentIdentity(record);
  return records;
}
