/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";

export function createRequestHash(payload = {}) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function assertCommandRequestMatches(storedHash = "", requestHash = "") {
  if (!storedHash || storedHash === requestHash) return;
  const error = new Error("commandId was reused with a different request");
  error.statusCode = 409;
  error.errorCode = "COMMAND_ID_REUSE_CONFLICT";
  throw error;
}

export function findMutationReceipt(session = {}, operation = "", commandId = "") {
  if (!commandId) return null;
  return (Array.isArray(session?.mutationReceipts) ? session.mutationReceipts : []).find((receipt) =>
    receipt?.operation === operation && receipt?.commandId === commandId) || null;
}

export function rememberMutationReceipt(session = {}, receipt = {}) {
  session.mutationReceipts = [
    ...(Array.isArray(session.mutationReceipts) ? session.mutationReceipts : []),
    receipt,
  ].slice(-100);
}

export function normalizeExpectedAggregateVersion(expectedAggregateVersion) {
  if (expectedAggregateVersion === null || expectedAggregateVersion === undefined || expectedAggregateVersion === "") return null;
  if (!Number.isSafeInteger(expectedAggregateVersion) || expectedAggregateVersion < 0) {
    const error = new Error("expectedAggregateVersion must be a non-negative safe integer");
    error.statusCode = 400;
    error.errorCode = "INVALID_SESSION_AGGREGATE_VERSION";
    throw error;
  }
  return expectedAggregateVersion;
}
