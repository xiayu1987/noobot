/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const clean = (value) => String(value || "").trim();
export function normalizeCommandReceipt(receipt = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
  const commandId = clean(receipt.commandId);
  const type = clean(receipt.type);
  const requestHash = clean(receipt.requestHash);
  if (!commandId || !type || !requestHash) return null;
  const aggregateVersion = Number(receipt.aggregateVersion || 0);
  if (!Number.isSafeInteger(aggregateVersion) || aggregateVersion < 0) return null;
  for (const field of ["revision", "sequence"]) {
    if (
      receipt[field] !== undefined &&
      (!Number.isSafeInteger(Number(receipt[field])) || Number(receipt[field]) < 0)
    ) {
      return null;
    }
  }
  return {
    commandId,
    type,
    requestHash,
    aggregateVersion,
    committedAt: clean(receipt.committedAt),
    ...(clean(receipt.turnScopeId) ? { turnScopeId: clean(receipt.turnScopeId) } : {}),
    ...(receipt.result && typeof receipt.result === "object" && !Array.isArray(receipt.result)
      ? { result: structuredClone(receipt.result) }
      : {}),
    ...(Number.isInteger(Number(receipt.revision)) ? { revision: Number(receipt.revision) } : {}),
    ...(Number.isInteger(Number(receipt.sequence)) ? { sequence: Number(receipt.sequence) } : {}),
    ...(clean(receipt.eventId) ? { eventId: clean(receipt.eventId) } : {}),
    ...(receipt.envelope && typeof receipt.envelope === "object" && !Array.isArray(receipt.envelope)
      ? { envelope: structuredClone(receipt.envelope) }
      : {}),
  };
}
export function normalizeCommandReceipts(receipts = []) {
  if (!Array.isArray(receipts)) throw new TypeError("command receipts must be an array");
  const normalized = receipts.map(normalizeCommandReceipt);
  if (normalized.some((receipt) => !receipt)) throw new TypeError("invalid command receipt");
  return normalized.slice(-200);
}
export function decideCommandIdempotency({ commandId, type, requestHash, receipts = [] } = {}) {
  const id = clean(commandId);
  const commandType = clean(type);
  const hash = clean(requestHash);
  if (!id || !commandType || !hash)
    return Object.freeze({ allowed: false, reason: "invalid_command_identity" });
  const receipt = normalizeCommandReceipts(receipts).find((item) => item.commandId === id);
  if (!receipt) return Object.freeze({ allowed: true, deduplicated: false });
  if (receipt.type !== commandType || receipt.requestHash !== hash)
    return Object.freeze({ allowed: false, reason: "command_id_reuse_conflict" });
  return Object.freeze({ allowed: true, deduplicated: true, receipt });
}
export function appendCommandReceipt(receipts = [], receipt = {}) {
  const normalized = normalizeCommandReceipt(receipt);
  if (!normalized) throw new TypeError("invalid command receipt");
  const decision = decideCommandIdempotency({ ...normalized, receipts });
  if (!decision.allowed) throw new TypeError(decision.reason);
  return decision.deduplicated
    ? normalizeCommandReceipts(receipts)
    : normalizeCommandReceipts([...receipts, normalized]);
}
