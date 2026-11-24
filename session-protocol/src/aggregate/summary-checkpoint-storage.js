/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";
import { requireCheckpointMessageUids } from "./checkpoint-message-uids.js";

export { requireCheckpointMessageUids } from "./checkpoint-message-uids.js";

export function checkpointIdentityError(reason) {
  return Object.assign(new TypeError(`summary checkpoint identity invalid: ${reason}`), {
    code: SESSION_ERROR_CODE.SUMMARY_CHECKPOINT_IDENTITY_INVALID,
  });
}

const CHECKPOINT_UID_LIST_FIELDS = Object.freeze(["persistedMessageUids", "summarizedMessageUids"]);

const projectedCheckpointIdentities = new WeakSet();

function assertCheckpointIdentity(identity, owner, index) {
  if (!projectedCheckpointIdentities.has(identity))
    throw checkpointIdentityError("identity must come from projectCheckpointIdentity");
  for (const key of ["sessionId", "turnId", "turnScopeId", "dialogProcessId"]) {
    if (!isCanonicalText(identity[key]) || identity[key] !== owner[key])
      throw checkpointIdentityError(`${key} does not match owner`);
  }
  for (const key of ["checkpointId", "checkpointRevision", "committedAt"]) {
    if (identity[key] !== index[key]) throw checkpointIdentityError(`${key} does not match index`);
  }
}

const CHECKPOINT_IDENTITY_FIELDS = Object.freeze([
  "sessionId",
  "turnId",
  "turnScopeId",
  "dialogProcessId",
  "checkpointId",
  "checkpointRevision",
  "committedAt",
  "previousCheckpointHash",
  "persistedMessageUids",
  "summarizedMessageUids",
]);

export function projectCheckpointIdentity(payload) {
  const identity = Object.fromEntries(CHECKPOINT_IDENTITY_FIELDS.map((key) => [key, payload[key]]));
  for (const key of CHECKPOINT_UID_LIST_FIELDS) {
    const values = identity[key];
    requireCheckpointMessageUids(values, key, () =>
      checkpointIdentityError(`${key} must be a unique UID list`),
    );
    identity[key] = Object.freeze([...values]);
  }
  projectedCheckpointIdentities.add(identity);
  return Object.freeze(identity);
}

function sameUidList(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((uid, index) => uid === right[index])
  );
}

function assertReceiptMatchesCheckpoint(receipt, payload) {
  for (const key of ["checkpointId", "checkpointRevision", "committedAt"])
    if (receipt[key] !== payload[key]) throw checkpointIdentityError(`receipt ${key} mismatch`);
  for (const key of CHECKPOINT_UID_LIST_FIELDS) {
    if (Object.hasOwn(receipt, key) && !sameUidList(receipt[key], payload[key]))
      throw checkpointIdentityError(`receipt ${key} mismatch`);
  }
}

function projectCheckpointReceipt(receipt, payload) {
  assertReceiptMatchesCheckpoint(receipt, payload);
  const projected = { ...receipt };
  for (const key of CHECKPOINT_UID_LIST_FIELDS) projected[key] = [...payload[key]];
  return projected;
}

export function createCheckpointIdentitySource(session) {
  const byScope = new Map();
  return {
    collect(turn, index, payload) {
      assertCheckpointIdentity(payload, { ...turn, sessionId: session.sessionId }, index);
      let source = byScope.get(turn.turnScopeId);
      if (!source) {
        source = { turn, payloads: new Map(), revision: 0 };
        byScope.set(turn.turnScopeId, source);
      }
      if (
        source.turn.turnId !== turn.turnId ||
        source.payloads.has(payload.checkpointId) ||
        payload.checkpointRevision <= source.revision
      )
        throw checkpointIdentityError("checkpoint identities must be unique and ordered");
      source.payloads.set(payload.checkpointId, payload);
      source.revision = payload.checkpointRevision;
    },
    resolve(scope, receipt, currentSession = session) {
      const source = byScope.get(scope);
      const payload = source?.payloads.get(receipt.checkpointId);
      const state = currentSession.turnSummaryCheckpoints[scope];
      if (
        !payload ||
        state.turnScopeId !== scope ||
        state.dialogProcessId !== source.turn.dialogProcessId
      )
        throw checkpointIdentityError(
          `receipt checkpoint is missing or has another owner: ${scope}/${receipt.checkpointId}`,
        );
      return payload;
    },
  };
}

function mapReceiptList(source, scope, project) {
  let receipts = source;
  source.forEach((receipt, index) => {
    const projected = project(receipt, scope);
    if (projected === receipt) return;
    if (receipts === source) receipts = source.slice();
    receipts[index] = projected;
  });
  return receipts;
}

function mapCheckpointReceipts(session, project) {
  if (!Object.hasOwn(session, "turnSummaryCheckpoints")) return session;
  const source = session.turnSummaryCheckpoints;
  let checkpoints = source;
  for (const scope of Object.keys(source)) {
    const state = source[scope];
    const receipts = mapReceiptList(state.receipts, scope, project);
    if (receipts === state.receipts) continue;
    if (checkpoints === source) checkpoints = { ...source };
    Object.defineProperty(checkpoints, scope, {
      value: { ...state, receipts },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return checkpoints === source ? session : { ...session, turnSummaryCheckpoints: checkpoints };
}

function copyRetainedMessageUids(receipt) {
  const owned = { ...receipt };
  if (Array.isArray(receipt.retainedMessageUids))
    owned.retainedMessageUids = [...receipt.retainedMessageUids];
  return owned;
}

export function hydrateCheckpointReceipts(session, resolvePayload) {
  return mapCheckpointReceipts(session, (receipt, scope) =>
    copyRetainedMessageUids(projectCheckpointReceipt(receipt, resolvePayload(scope, receipt))),
  );
}

export function copyCheckpointReceiptLists(session) {
  return mapCheckpointReceipts(session, (receipt) => {
    const owned = copyRetainedMessageUids(receipt);
    for (const key of CHECKPOINT_UID_LIST_FIELDS) owned[key] = [...receipt[key]];
    return owned;
  });
}

export function assertStoredCheckpointReceipts(session) {
  if (!Object.hasOwn(session, "turnSummaryCheckpoints")) return;
  if (!isPlainObject(session.turnSummaryCheckpoints))
    throw checkpointIdentityError("states must be an object");
  for (const state of Object.values(session.turnSummaryCheckpoints)) {
    if (!isPlainObject(state) || !Array.isArray(state.receipts))
      throw checkpointIdentityError("receipts must be an array");
    for (const receipt of state.receipts) {
      if (
        !isPlainObject(receipt) ||
        CHECKPOINT_UID_LIST_FIELDS.some((key) => Object.hasOwn(receipt, key))
      )
        throw checkpointIdentityError("stored receipt must reference checkpoint identity");
    }
  }
}
