/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  advanceAuxiliaryModelContext,
  AUXILIARY_SEQUENCE_MESSAGE_KIND,
  projectAuxiliaryMessagesForProvider,
  resolveAuxiliarySequenceIdentity,
} from "@noobot/context-protocol/assembly/auxiliary-sequence";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { text } from "@noobot/shared/value";

const snapshots = new Map();
const maxEntries = QUANTITY_THRESHOLDS.harness.incrementalMessageCacheEntries;

function snapshotKey(ctx = {}, purpose = "") {
  const sessionId = text(ctx?.sessionId);
  const normalizedPurpose = text(purpose);
  return sessionId && normalizedPurpose ? `${sessionId}::${normalizedPurpose}` : "";
}

function buildCurrentContext(ctx = {}, messages = []) {
  const messageBlocks = { system: [], history: [], incremental: [] };
  for (const message of Array.isArray(messages) ? messages : []) {
    const identity = resolveAuxiliarySequenceIdentity(message);
    if (!identity) throw new TypeError("Harness auxiliary message requires sequence identity");
    if (identity.kind === AUXILIARY_SEQUENCE_MESSAGE_KIND.REQUEST) {
      messageBlocks.incremental.push(message);
    } else if (text(message?.role).toLowerCase() === "system") {
      messageBlocks.system.push(message);
    } else {
      messageBlocks.history.push(message);
    }
  }
  return {
    checkpointRevision: ctx?.modelContext?.checkpointRevision,
    messageBlocks,
  };
}

function pruneSnapshots() {
  while (snapshots.size > maxEntries) snapshots.delete(snapshots.keys().next().value);
}

export function resolveAuxiliarySnapshotMessages({ ctx = {}, purpose = "", messages = [] } = {}) {
  const key = snapshotKey(ctx, purpose);
  const transition = advanceAuxiliaryModelContext({
    previousSnapshot: key ? snapshots.get(key) : null,
    currentContext: buildCurrentContext(ctx, messages),
  });
  if (key) {
    snapshots.set(key, transition.snapshot);
    pruneSnapshots();
  }
  return projectAuxiliaryMessagesForProvider(transition.messages);
}

export function clearAuxiliarySnapshotsForContext(ctx = {}) {
  const sessionId = text(ctx?.sessionId);
  if (!sessionId) return 0;
  let deleted = 0;
  for (const key of snapshots.keys()) {
    if (key.startsWith(`${sessionId}::`)) {
      snapshots.delete(key);
      deleted += 1;
    }
  }
  return deleted;
}
