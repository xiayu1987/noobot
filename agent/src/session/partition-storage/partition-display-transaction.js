/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { PARTITION_MESSAGE_COLLECTIONS as collections } from "@noobot/session-protocol/partition-session-messages";
import { readPartitionLifecycleHeader } from "@noobot/session-protocol/partition-session-state";
import { PARTITION_LIFECYCLE_HEADER } from "@noobot/session-protocol/partition-transaction";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import {
  createSessionDisplayPublicationRow,
  sessionDisplayMessageProjection,
} from "@noobot/session-protocol/session-reader";
import {
  stagePartitionDisplayPublication,
  readPartitionDisplayStatistics,
} from "./partition-display-publication.js";
import { calculatePartitionDisplaySourceCounts } from "./partition-display-source-counts.js";
import { projectPartitionDisplayTurnTransition } from "./partition-display-turn.js";
import { createPartitionIndexMutations } from "./partition-index-mutations.js";

function conflict() {
  throw new PartitionAdmissionRejection(
    "SESSION_TURN_IDENTITY_CONFLICT",
    "Display presentation belongs to multiple turns",
  );
}

function changesDisplaySource(previous, next) {
  if (previous === null || next === null) return true;
  return !isDeepStrictEqual(
    sessionDisplayMessageProjection(previous.message),
    sessionDisplayMessageProjection(next.message),
  );
}

async function affectedTurns(plan, read, transitions) {
  const turns = new Set();
  for (const { collection, key } of plan.changes()) {
    if (collection === collections.turns || collection === "lifecycle") turns.add(key);
  }
  for (const { before, after } of transitions) {
    if (!changesDisplaySource(before, after)) continue;
    if (before !== null) turns.add(before.message.turnScopeId);
    if (after !== null) turns.add(after.message.turnScopeId);
  }
  const { collection, key } = PARTITION_LIFECYCLE_HEADER;
  if (!plan.hasStaged(collection, key)) return turns;
  const before = (await readPartitionLifecycleHeader(read)).activeTurnScopeId;
  const after = (await readPartitionLifecycleHeader(plan.readStaged)).activeTurnScopeId;
  if (before === after) return turns;
  if (before) turns.add(before);
  if (after) turns.add(after);
  return turns;
}

function collectRows(entries, rows, identities) {
  for (const entry of entries) {
    const { order, row } = entry;
    const key = JSON.stringify(order);
    if (rows.has(key))
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Duplicate display order position");
    rows.set(key, entry);
    if (row.role !== "assistant") continue;
    if (identities.has(row.presentationMessageId)) conflict();
    identities.set(row.presentationMessageId, row.turnScopeId);
  }
}

function appendTurnTransition(groups, id, transition) {
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(transition);
}

function groupDisplayTransitions(transitions) {
  const groups = new Map();
  for (const { before, after } of transitions) {
    const previousTurn = before?.message.turnScopeId;
    const nextTurn = after?.message.turnScopeId;
    if (previousTurn === undefined && nextTurn === undefined) continue;
    if (previousTurn === nextTurn) {
      appendTurnTransition(groups, previousTurn, { before, after });
      continue;
    }
    if (previousTurn !== undefined)
      appendTurnTransition(groups, previousTurn, { before, after: null });
    if (nextTurn !== undefined) appendTurnTransition(groups, nextTurn, { before: null, after });
  }
  return groups;
}

async function stagePresentationOwners(plan, previous, next) {
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const before = previous.get(id);
    const after = next.get(id);
    if (before === after) continue;
    const collection = "metadata";
    const key = `display:presentation:${JSON.stringify(id)}`;
    const stored = await plan.get(collection, key);
    if (before !== undefined && stored !== before)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Display presentation ownership mismatch",
      );
    if (before === undefined && stored !== null) conflict();
    if (after === undefined) plan.remove(collection, key);
    else plan.set(collection, key, after);
  }
}

const artifactFields = {
  displayToolLogCount: "assignedToolArtifactCount",
  unassignedToolArtifactCount: "unassignedToolArtifactCount",
  conflictedToolArtifactCount: "conflictedToolArtifactCount",
};

export async function preparePartitionDisplayTransaction({
  snapshot,
  view,
  mutations,
  scope,
  transitions,
}) {
  const plan = createPartitionIndexMutations(view, mutations);
  const read = plan.readOriginal;
  const turns = await affectedTurns(plan, read, transitions);
  if (!turns.size) return;
  const stats = await readPartitionDisplayStatistics(read);
  const sourceStatistics = await calculatePartitionDisplaySourceCounts(
    plan.readStaged,
    stats,
    transitions,
  );
  const previous = new Map();
  const next = new Map();
  const previousIds = new Map();
  const nextIds = new Map();
  for (const field of Object.keys(artifactFields)) sourceStatistics[field] = stats[field];
  sourceStatistics.thinkingMessageCount = stats.thinkingMessageCount;
  let artifactAttachmentDelta = 0;
  const byTurn = groupDisplayTransitions(transitions);
  for (const turnScopeId of turns) {
    const identity = { snapshot, scope, turnScopeId, generation: view.generation };
    const { before, after, thinkingCountDelta } = await projectPartitionDisplayTurnTransition(
      plan,
      read,
      identity,
      byTurn.get(turnScopeId) ?? [],
    );
    collectRows(before.rows, previous, previousIds);
    collectRows(after.rows, next, nextIds);
    sourceStatistics.thinkingMessageCount += thinkingCountDelta;
    for (const [field, count] of Object.entries(artifactFields))
      sourceStatistics[field] += after.toolArtifactStats[count] - before.toolArtifactStats[count];
    artifactAttachmentDelta +=
      after.toolArtifactStats.attachmentCount - before.toolArtifactStats.attachmentCount;
  }
  const changes = [];
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    const before = previous.get(key);
    const after = next.get(key);
    const oldRow = before === undefined ? null : createSessionDisplayPublicationRow(before.row);
    const row = after === undefined ? null : createSessionDisplayPublicationRow(after.row);
    if (isDeepStrictEqual(oldRow, row)) continue;
    changes.push({ order: (after ?? before).order, existed: before !== undefined, row });
  }
  await stagePresentationOwners(plan, previousIds, nextIds);
  await stagePartitionDisplayPublication(plan, {
    changes,
    sourceStatistics,
    artifactAttachmentDelta,
  });
  await plan.apply();
}
