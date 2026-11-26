/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { WORKSPACE_LAYOUT_UPGRADE_OWNER as OWNER } from "./layout-migration.js";

const historicalSessionOwners = new Set([
  OWNER.SESSION_STORAGE,
  OWNER.SESSION_LIFECYCLE,
  OWNER.SESSION_TRANSFER_ENVELOPE,
  OWNER.MODEL_CONTEXT_SNAPSHOT,
  OWNER.SESSION_MESSAGE_IDENTITY,
  OWNER.EXECUTION_EVENT_INDEX,
  OWNER.SESSION_TASK_ARTIFACT,
  OWNER.SESSION_MUTATION_REFS,
  OWNER.SESSION_ACTIVITY_TIMELINE,
  OWNER.SESSION_TOOL_RESULT,
  OWNER.SESSION_SCRIPT_EXIT_CODE,
  OWNER.SESSION_LEGACY_MCP_RESULT,
  OWNER.SESSION_RESULT_OVERFLOW,
  OWNER.SESSION_CHECKPOINT_IDENTITY,
  OWNER.SESSION_PHASE_SUMMARY,
  OWNER.SESSION_IMMUTABLE_STORAGE,
  OWNER.SESSION_PARTITION_STORAGE,
]);

const requiredFields = ["kind", "path", "moved", "quarantinedAt", "error"];
const receiptFields = new Set([
  ...requiredFields,
  "moveIdentity",
  "restored",
  "deleting",
  "sessionStorage",
  "quarantineId",
]);

export const SESSION_STORAGE_QUARANTINE_STATUS = Object.freeze({
  UNSUPPORTED: "unsupported-format",
  FAILED: "upgrade-failed",
  PARENT_UNAVAILABLE: "parent-unavailable",
  HISTORICAL_FAILURE: "historical-upgrade-failed",
});

export function normalizeMigrationQuarantinePath(value) {
  const parts = typeof value === "string" ? value.split(/[\\/]/u) : [];
  if (
    !parts.length ||
    parts.some((part) => !part || part === "." || part === ".." || /[:\0]/u.test(part))
  )
    throw new TypeError("Invalid workspace migration quarantine path");
  return parts.join("/");
}

export function requireSessionStorageQuarantine(value) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).some((key) => !["format", "status", "parentPath"].includes(key)) ||
    !Object.values(SESSION_STORAGE_QUARANTINE_STATUS).includes(value.status) ||
    !["immutable", "document", "partition", "conflicting", "unverified"].includes(value.format) ||
    (value.status === SESSION_STORAGE_QUARANTINE_STATUS.HISTORICAL_FAILURE) !==
      (value.format === "unverified") ||
    (value.status === SESSION_STORAGE_QUARANTINE_STATUS.UNSUPPORTED &&
      !["immutable", "document"].includes(value.format)) ||
    (value.status === SESSION_STORAGE_QUARANTINE_STATUS.FAILED &&
      !["partition", "conflicting"].includes(value.format)) ||
    (value.status === SESSION_STORAGE_QUARANTINE_STATUS.PARENT_UNAVAILABLE
      ? value.format !== "partition" || !isCanonicalText(value.parentPath)
      : Object.hasOwn(value, "parentPath"))
  )
    throw new TypeError("Invalid session storage quarantine classification");
  if (Object.hasOwn(value, "parentPath")) normalizeMigrationQuarantinePath(value.parentPath);
  return value;
}

export function readWorkspaceMigrationQuarantineRecord(value) {
  const record = assertWorkspaceMigrationQuarantineRecord(value);
  const { sessionStorage } = record;
  return {
    ...record,
    path: normalizeMigrationQuarantinePath(record.path),
    ...(sessionStorage && Object.hasOwn(sessionStorage, "parentPath")
      ? {
          sessionStorage: {
            ...sessionStorage,
            parentPath: normalizeMigrationQuarantinePath(sessionStorage.parentPath),
          },
        }
      : {}),
  };
}

export function classifyHistoricalMigrationQuarantine(record) {
  assertWorkspaceMigrationQuarantineRecord(record);
  if (record.sessionStorage !== undefined || !historicalSessionOwners.has(record.kind))
    return record;
  return assertWorkspaceMigrationQuarantineRecord({
    ...record,
    sessionStorage: {
      format: "unverified",
      status: SESSION_STORAGE_QUARANTINE_STATUS.HISTORICAL_FAILURE,
    },
  });
}

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
    (Object.hasOwn(record, "deleting") &&
      (record.deleting !== true || !record.moved || record.restored || !record.sessionStorage)) ||
    !isPlainObject(record.error) ||
    typeof record.error.code !== "string" ||
    typeof record.error.message !== "string"
  )
    throw new TypeError("Invalid workspace migration quarantine record");
  normalizeMigrationQuarantinePath(record.path);
  if (
    record.moved
      ? typeof record.moveIdentity !== "string" || !/^\d+:\d+$/u.test(record.moveIdentity)
      : Object.hasOwn(record, "moveIdentity")
  )
    throw new TypeError("Moved quarantine records require the original filesystem identity");
  if (record.sessionStorage !== undefined) {
    requireSessionStorageQuarantine(record.sessionStorage);
    if (record.sessionStorage.status === SESSION_STORAGE_QUARANTINE_STATUS.HISTORICAL_FAILURE) {
      if (Object.hasOwn(record, "quarantineId"))
        throw new TypeError("Historical quarantine retains its original receipt identity");
      return record;
    }
    if (typeof record.quarantineId !== "string" || !/^[a-f0-9]{64}$/u.test(record.quarantineId))
      throw new TypeError("Session storage quarantine requires an independent unit identity");
    if (!record.moved || record.restored === true)
      throw new TypeError("Terminal session storage quarantine requires a retained, moved source");
  } else if (Object.hasOwn(record, "quarantineId"))
    throw new TypeError("Unexpected quarantine identity");
  return record;
}
