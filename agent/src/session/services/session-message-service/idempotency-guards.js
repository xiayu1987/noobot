/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";

export function createRequestHash(payload = {}) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function assertIdempotencyRequestMatches(storedHash = "", requestHash = "") {
  if (!storedHash || storedHash === requestHash) return;
  const error = new Error("idempotency key was reused with a different request");
  error.statusCode = 409;
  error.errorCode = "IDEMPOTENCY_KEY_REUSED";
  throw error;
}

export function findMutationReceipt(session = {}, operation = "", idempotencyKey = "") {
  if (!idempotencyKey) return null;
  return (Array.isArray(session?.mutationReceipts) ? session.mutationReceipts : []).find((receipt) =>
    receipt?.operation === operation && receipt?.idempotencyKey === idempotencyKey) || null;
}

export function rememberMutationReceipt(session = {}, receipt = {}) {
  session.mutationReceipts = [
    ...(Array.isArray(session.mutationReceipts) ? session.mutationReceipts : []),
    receipt,
  ].slice(-100);
}

export function normalizeExpectedVersion(expectedVersion) {
  if (expectedVersion === null || expectedVersion === undefined || expectedVersion === "") return null;
  const normalized = Number(expectedVersion);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    const error = new Error("expectedVersion must be a non-negative safe integer");
    error.statusCode = 400;
    error.errorCode = "INVALID_SESSION_VERSION";
    throw error;
  }
  return normalized;
}
