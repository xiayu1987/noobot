/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

const requiredFields = ["kind", "path", "moved", "quarantinedAt", "error"];
const receiptFields = new Set([...requiredFields, "moveIdentity", "restored"]);

export function assertWorkspaceMigrationQuarantineRecord(record) {
  if (
    !isPlainObject(record) ||
    requiredFields.some((field) => !Object.hasOwn(record, field)) ||
    Object.keys(record).some((field) => !receiptFields.has(field)) ||
    !isCanonicalText(record.kind) ||
    !isCanonicalText(record.path) ||
    typeof record.moved !== "boolean" ||
    !isCanonicalText(record.quarantinedAt) ||
    !Number.isFinite(Date.parse(record.quarantinedAt)) ||
    (Object.hasOwn(record, "restored") && record.restored !== true) ||
    !isPlainObject(record.error) ||
    typeof record.error.code !== "string" ||
    typeof record.error.message !== "string"
  )
    throw new TypeError("Invalid workspace migration quarantine record");
  if (
    record.moved
      ? typeof record.moveIdentity !== "string" || !/^\d+:\d+$/u.test(record.moveIdentity)
      : Object.hasOwn(record, "moveIdentity")
  )
    throw new TypeError("Moved quarantine records require the original filesystem identity");
  return record;
}
