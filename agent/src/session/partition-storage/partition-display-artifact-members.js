/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import { attachmentIdentityKey } from "@noobot/attachment-protocol";
import { transferIdentityKey, transferProtocolValueKey } from "@noobot/semantic-transfer-protocol";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { sessionDisplayArtifactMemberKey } from "@noobot/session-protocol/session-reader";

const digest = (value) => createHash("sha256").update(value).digest("base64url");

function collect(deltas, envelopes, direction) {
  const attachments = new Set();
  for (const envelope of envelopes) {
    const identity = digest(transferIdentityKey(envelope));
    const version = digest(transferProtocolValueKey(envelope));
    if (!deltas.transfers.has(identity)) deltas.transfers.set(identity, new Map());
    const versions = deltas.transfers.get(identity);
    versions.set(version, (versions.get(version) ?? 0) + direction);
    if (envelope.payload.mode !== "attachment") continue;
    for (const ref of envelope.payload.attachments)
      attachments.add(digest(attachmentIdentityKey(ref.identity)));
  }
  for (const identity of attachments)
    deltas.attachments.set(identity, (deltas.attachments.get(identity) ?? 0) + direction);
}

function counters(plan, turnScopeId) {
  return async (kind, parts, delta) => {
    const key = sessionDisplayArtifactMemberKey(turnScopeId, kind, ...parts);
    const value = await plan.get("metadata", key);
    const before = value === null ? 0 : value;
    const after = before + delta;
    if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(after) || after < 0)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Invalid display artifact membership count",
      );
    if (delta !== 0) {
      if (after === 0) plan.remove("metadata", key);
      else plan.set("metadata", key, after);
    }
    return { before, after };
  };
}

async function updateTransferVariants(update, identity, versions) {
  let variants = 0;
  for (const [version, delta] of versions) {
    if (!delta) continue;
    const { before, after } = await update("transfer-value", [identity, version], delta);
    variants += Number(after > 0) - Number(before > 0);
  }
  return variants;
}

export async function updateArtifactMembers(plan, turnScopeId, changes) {
  const deltas = { transfers: new Map(), attachments: new Map() };
  for (const { before, after } of changes) {
    collect(deltas, before, -1);
    collect(deltas, after, 1);
  }
  const update = counters(plan, turnScopeId);
  let conflictDelta = 0;
  let attachmentDelta = 0;
  for (const [identity, versions] of deltas.transfers) {
    const variants = await updateTransferVariants(update, identity, versions);
    if (!variants) continue;
    const { before, after } = await update("transfer", [identity], variants);
    conflictDelta += Number(after > 1) - Number(before > 1);
  }
  for (const [identity, delta] of deltas.attachments) {
    if (!delta) continue;
    const { before, after } = await update("attachment", [identity], delta);
    attachmentDelta += Number(after > 0) - Number(before > 0);
  }
  return { conflictDelta, attachmentDelta };
}
