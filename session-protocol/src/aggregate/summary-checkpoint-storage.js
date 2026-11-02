/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";

export function checkpointIdentityError(reason) {
  return Object.assign(new TypeError(`summary checkpoint identity invalid: ${reason}`), {
    code: SESSION_ERROR_CODE.SUMMARY_CHECKPOINT_IDENTITY_INVALID,
  });
}

export function assertCheckpointIdentity(payload, owner, index) {
  for (const key of ["sessionId", "turnId", "turnScopeId", "dialogProcessId"]) {
    if (!isCanonicalText(payload[key]) || payload[key] !== owner[key])
      throw checkpointIdentityError(`${key} does not match owner`);
  }
  for (const key of ["checkpointId", "checkpointRevision", "committedAt"]) {
    if (payload[key] !== index[key]) throw checkpointIdentityError(`${key} does not match index`);
  }
  for (const key of ["persistedMessageUids", "summarizedMessageUids"]) {
    const values = payload[key];
    if (
      !Array.isArray(values) ||
      !values.every(isCanonicalText) ||
      new Set(values).size !== values.length
    )
      throw checkpointIdentityError(`${key} must be a unique UID list`);
  }
  return payload;
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
  return Object.fromEntries(CHECKPOINT_IDENTITY_FIELDS.map((key) => [key, payload[key]]));
}

export function projectCheckpointReceipt(receipt, payload) {
  for (const key of ["checkpointId", "checkpointRevision", "committedAt"])
    if (receipt[key] !== payload[key]) throw checkpointIdentityError(`receipt ${key} mismatch`);
  const projected = { ...receipt };
  for (const key of ["persistedMessageUids", "summarizedMessageUids"]) {
    if (
      Object.hasOwn(receipt, key) &&
      JSON.stringify(receipt[key]) !== JSON.stringify(payload[key])
    )
      throw checkpointIdentityError(`receipt ${key} mismatch`);
    projected[key] = [...payload[key]];
  }
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
    resolve(scope, receipt) {
      const source = byScope.get(scope);
      const payload = source?.payloads.get(receipt.checkpointId);
      const state = session.turnSummaryCheckpoints[scope];
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

function mapCheckpointReceipts(session, project) {
  if (!Object.hasOwn(session, "turnSummaryCheckpoints")) return session;
  return {
    ...session,
    turnSummaryCheckpoints: Object.fromEntries(
      Object.entries(session.turnSummaryCheckpoints).map(([scope, state]) => [
        scope,
        { ...state, receipts: state.receipts.map((receipt) => project(scope, receipt)) },
      ]),
    ),
  };
}

export function storeCheckpointReceipts(session, resolvePayload) {
  return mapCheckpointReceipts(session, (scope, receipt) => {
    const projected = projectCheckpointReceipt(receipt, resolvePayload(scope, receipt));
    delete projected.persistedMessageUids;
    delete projected.summarizedMessageUids;
    return projected;
  });
}

export function hydrateCheckpointReceipts(session, resolvePayload) {
  return mapCheckpointReceipts(session, (scope, receipt) =>
    projectCheckpointReceipt(receipt, resolvePayload(scope, receipt)),
  );
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
        ["persistedMessageUids", "summarizedMessageUids"].some((key) => Object.hasOwn(receipt, key))
      )
        throw checkpointIdentityError("stored receipt must reference checkpoint identity");
    }
  }
}
