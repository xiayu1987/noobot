/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { projectTurnMessage } from "@noobot/session-protocol";
import { attachmentIdentityKey } from "@noobot/attachment-protocol";
import {
  readPartitionLifecycleHeader,
  readPartitionTurnMembershipAndStates,
} from "@noobot/session-protocol/partition-session-state";
import {
  createSessionDisplayArtifactSummary,
  isFinalDisplayAssistantSource,
  sessionDisplayArtifactResultKey,
  sessionDisplayArtifactStateKey,
  sessionDisplayAssistantCountKey,
  sessionDisplayDependencyDirectory,
  sessionDisplayRowOrderKey,
} from "@noobot/session-protocol/session-reader";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { text } from "@noobot/shared/value";
import { checkMessage, readTurnPosition } from "./partition-message-reader.js";
import { updateArtifactMembers } from "./partition-display-artifact-members.js";
import {
  emptyArtifactState,
  readArtifactOwner,
  readArtifactState,
  readDisplayAssistantCount,
} from "./partition-display-artifacts.js";
import {
  buildSessionDisplayEntries,
  contributesDisplayThinkingDetails,
} from "../session-summary-builders/display-message-list.js";
import { pickLightTransferEnvelopes } from "../session-summary-builders/message-metadata-projection.js";
import { hasToolResultArtifacts } from "../session-summary-builders/turn-artifact-projection.js";
import { buildDisplayMessageSummary } from "../session-summary-builders/message-summary-projection.js";

async function readDisplayTurnState(read, identity) {
  const { turnScopeId } = identity;
  const header = await readPartitionLifecycleHeader(read);
  const { turns, states } = await readPartitionTurnMembershipAndStates(
    read,
    [turnScopeId],
    header,
    (record, messageUid) => checkMessage(record, { ...identity, messageUid, indexed: true }),
  );
  const lifecycle = states.get(turnScopeId) ?? null;
  const active = header.activeTurnScopeId === turnScopeId;
  if (active && lifecycle === null)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing active lifecycle turn");
  const membership = turns.get(turnScopeId)?.mutation;
  return { lifecycle, active, membership: membership?.remove ? null : (membership?.value ?? null) };
}

function addOrdinal(index, key, ordinal) {
  let ordinals = index.get(key);
  if (ordinals === undefined) {
    ordinals = new Set();
    index.set(key, ordinals);
  }
  ordinals.add(ordinal);
}

function dependencies(sources) {
  const groups = {
    user: new Set(),
    assistants: new Set(),
    canonical: new Set(),
    timeline: new Set(),
  };
  const artifactCalls = new Map();
  const byId = new Map();
  const finalById = new Map();
  for (const { turnOrdinal, message } of sources.values()) {
    const row = buildDisplayMessageSummary(message);
    if (row?.role === "user") groups.user.add(turnOrdinal);
    if (row?.role === "assistant")
      recordAssistantDependency(row, turnOrdinal, { groups, byId, finalById });
    if (contributesDisplayThinkingDetails(message)) groups.timeline.add(turnOrdinal);
    if (!hasToolResultArtifacts(message)) continue;
    const callId = text(message.tool_call_id);
    if (callId) addOrdinal(artifactCalls, callId, turnOrdinal);
  }
  return { groups, byId, finalById, artifactCalls };
}

function recordAssistantDependency(row, ordinal, { groups, byId, finalById }) {
  groups.assistants.add(ordinal);
  addOrdinal(byId, row.presentationMessageId, ordinal);
  if (!isFinalDisplayAssistantSource(row)) return;
  if (row.chatPresentation === true) groups.canonical.add(ordinal);
  addOrdinal(finalById, row.presentationMessageId, ordinal);
}

function describeTurnSources(identity, state, sources) {
  const { membership, lifecycle } = state;
  const records = [];
  for (const [turnOrdinal, source] of sources) {
    if (membership === null || turnOrdinal > membership.messageCount)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Display dependency outside owning turn",
      );
    const record = checkMessage(source, {
      ...identity,
      messageUid: source.message.messageUid,
      dialogProcessId: membership.dialogProcessId,
      turnOrdinal,
      indexed: true,
    });
    const message = projectTurnMessage(record.message, lifecycle);
    records.push({ ordinal: record.sessionOrdinal, message });
  }
  return records;
}

function projectDisplayTurn({ turnScopeId }, { active, lifecycle }, records) {
  const byUid = new Map(records.map((record) => [record.message.messageUid, record]));
  const sourceOrdinal = (message) => byUid.get(message.messageUid).ordinal;
  const entries = buildSessionDisplayEntries({
    messages: records.map(({ message }) => message),
    lifecycle: {
      activeTurnScopeId: active ? turnScopeId : "",
      turns: lifecycle === null ? {} : { [turnScopeId]: lifecycle },
    },
    selectSourceOrdinal: sourceOrdinal,
    thinkingTurns: new Set(),
  });
  return entries.map((entry) => ({
    order: sessionDisplayRowOrderKey(entry, { sourceOrdinal }),
    row: entry.row,
  }));
}

function changedSources(transitions, side) {
  const sources = new Map();
  for (const transition of transitions) {
    const record = transition[side];
    if (record === null) continue;
    if (sources.has(record.turnOrdinal))
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Duplicate display source transition");
    sources.set(record.turnOrdinal, record);
  }
  return sources;
}

function bindDirectories(plan, get, turnScopeId) {
  const collection = "metadata";
  const store = {
    get: (key) => get(collection, key),
    set: (key, value) => plan.set(collection, key, value),
    remove: (key) => plan.remove(collection, key),
  };
  return (kind, id) => sessionDisplayDependencyDirectory(store, turnScopeId, kind, id);
}

async function updateMembership(directory, previous, next) {
  for (const ordinal of previous) if (!next.has(ordinal)) await directory.update(ordinal, false);
  for (const ordinal of next) if (!previous.has(ordinal)) await directory.update(ordinal, true);
}

async function newest(directory) {
  for await (const ordinal of directory.ordinals()) return ordinal;
  return null;
}

async function includeAssistantRows(directory, id, include) {
  const candidates = directory("assistant", id);
  const first = await candidates.first();
  if (first === null) return;
  await include(first);
  const final = directory("assistant-final", id);
  const winner = await newest(final);
  await include(winner ?? (await newest(candidates)));
  if (winner === null) return;
  const oldestFinal = await final.first();
  if (oldestFinal !== winner) await include(oldestFinal);
}

async function includeCanonicalBoundaries(canonical, include) {
  const first = await canonical.first();
  if (first === null) return;
  await include(first);
  const last = await newest(canonical);
  if (last !== first) await include(last);
}

async function projectAffectedRows({ read, identity, state, directory, changed, groups }, ids) {
  const sources = new Map(
    [...changed].filter(([ordinal]) => groups.user.has(ordinal) || groups.assistants.has(ordinal)),
  );
  async function include(ordinal) {
    if (sources.has(ordinal)) return;
    if (state.membership === null || ordinal > state.membership.messageCount)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Display dependency outside owning turn",
      );
    const { dialogProcessId } = state.membership;
    sources.set(ordinal, await readTurnPosition(read, { ...identity, dialogProcessId }, ordinal));
  }
  for (const id of ids) await includeAssistantRows(directory, id, include);
  if (groups.canonical.size) await includeCanonicalBoundaries(directory("canonical"), include);
  const projectLifecycle =
    state.lifecycle !== null && ids.has(state.lifecycle.presentationMessageId);
  if (projectLifecycle) {
    const anchor = await newest(directory("user"));
    if (anchor !== null) await include(anchor);
  }
  const records = describeTurnSources(
    identity,
    state,
    [...sources].sort(([a], [b]) => a - b),
  );
  const rows = projectDisplayTurn(
    identity,
    projectLifecycle ? state : { active: false, lifecycle: null },
    records,
  );
  const userOrdinals = new Set(
    [...groups.user].map((ordinal) => changed.get(ordinal).sessionOrdinal),
  );
  return rows.filter(({ row }) =>
    row.role === "user" ? userOrdinals.has(row.sessionOrdinal) : ids.has(row.presentationMessageId),
  );
}

function assistantCount(rows) {
  return rows.filter(({ row }) => row.role === "assistant").length;
}

async function updateAssistantCount(plan, turnScopeId, before, after) {
  const key = sessionDisplayAssistantCountKey(turnScopeId);
  const prior = await readDisplayAssistantCount(plan.read, turnScopeId);
  const delta = after - before;
  const next = prior + delta;
  if (!Number.isSafeInteger(prior) || prior < before || !Number.isSafeInteger(next) || next < 0)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Invalid visible assistant count for display turn",
    );
  if (delta !== 0) {
    if (next === 0) plan.remove("metadata", key);
    else plan.set("metadata", key, next);
  }
  return { prior, next };
}

async function updateThinkingCount(original, staged, timelineChanged, { prior, next }) {
  if (prior === next && !timelineChanged) return 0;
  const previousThinking = prior > 0 && (await original("timeline").first()) !== null;
  let nextThinking = false;
  if (next > 0 && timelineChanged) nextThinking = (await staged("timeline").first()) !== null;
  else if (next > 0 && prior > 0) nextThinking = previousThinking;
  else if (next > 0) nextThinking = (await original("timeline").first()) !== null;
  return (nextThinking ? next : 0) - (previousThinking ? prior : 0);
}

const emptyArtifactStats = Object.freeze({
  assignedToolArtifactCount: 0,
  unassignedToolArtifactCount: 0,
  conflictedToolArtifactCount: 0,
  attachmentCount: 0,
});

async function stageArtifactIndex(plan, turnScopeId, beforeView, afterView) {
  const { directory: original, artifactCalls: previous } = beforeView;
  const { directory: staged, artifactCalls: next } = afterView;
  const readBefore = artifactEnvelopes(beforeView, afterView.changed);
  const readAfter = artifactEnvelopes(afterView, beforeView.changed);
  let countDelta = 0;
  const members = [];
  const empty = new Set();
  const retired = new Set();
  const published = new Set();
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const priorCalls = original("artifact-call", id);
    const before = await priorCalls.first();
    const calls = staged("artifact-call", id);
    await updateMembership(calls, previous.get(id) ?? empty, next.get(id) ?? empty);
    const after = await calls.first();
    if (before !== after && before !== null) retired.add(before);
    if (before !== after && after !== null) published.add(after);
    countDelta += Number(after !== null) - Number(before !== null);
    const previousResult = before === null ? null : await newest(priorCalls);
    const result = after === null ? null : await newest(calls);
    if (after !== null && (before !== after || previousResult !== result)) {
      const key = sessionDisplayArtifactResultKey(turnScopeId, after);
      plan.set("metadata", key, result);
    }
    const force = previousResult !== result;
    const beforeEnvelopes =
      previousResult === null ? [] : await readBefore(previousResult, id, force);
    const afterEnvelopes = result === null ? [] : await readAfter(result, id, force);
    if (!isDeepStrictEqual(beforeEnvelopes, afterEnvelopes))
      members.push({ before: beforeEnvelopes, after: afterEnvelopes });
  }
  for (const first of retired) {
    if (!published.has(first))
      plan.remove("metadata", sessionDisplayArtifactResultKey(turnScopeId, first));
  }
  await updateMembership(staged("artifact-order"), retired, published);
  return { countDelta, members };
}

function artifactEnvelopes({ read, identity, state, changed }, opposite) {
  return async (ordinal, callId, force) => {
    const record = changed.get(ordinal);
    if (!force && record === undefined && !opposite.has(ordinal)) return [];
    if (state.membership === null || ordinal > state.membership.messageCount)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Artifact dependency outside owning turn",
      );
    const { message } =
      record ??
      (await readTurnPosition(
        read,
        {
          ...identity,
          dialogProcessId: state.membership.dialogProcessId,
        },
        ordinal,
      ));
    if (!hasToolResultArtifacts(message) || text(message.tool_call_id) !== callId)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid display artifact winner");
    return pickLightTransferEnvelopes(message);
  };
}

function ownerEnvelopes(rows, owner) {
  if (owner === null) return [];
  const entry = rows.find(
    ({ row }) => row.role === "assistant" && row.presentationMessageId === owner,
  );
  if (!entry)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing display artifact owner");
  return entry.row.transferEnvelopes ?? [];
}

function attachmentCount(envelopes) {
  return new Set(
    envelopes.flatMap(({ payload }) =>
      payload.mode === "attachment"
        ? payload.attachments.map(({ identity }) => attachmentIdentityKey(identity))
        : [],
    ),
  ).size;
}

function artifactStats(state, owner, baseAttachments) {
  const { status, toolArtifactCount, assignedAttachmentCount } =
    createSessionDisplayArtifactSummary(state, owner);
  const stats = { ...emptyArtifactStats };
  if (status === "unassigned") stats.unassignedToolArtifactCount = toolArtifactCount;
  else if (status === "conflicted") stats.conflictedToolArtifactCount = toolArtifactCount;
  else if (status === "assigned") {
    stats.assignedToolArtifactCount = toolArtifactCount;
    stats.attachmentCount = assignedAttachmentCount - baseAttachments;
    if (stats.attachmentCount < 0)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Invalid display artifact attachment count",
      );
  }
  return stats;
}

async function stageArtifactState(plan, turnScopeId, prior, { count, members }) {
  const { conflictDelta, attachmentDelta } = await updateArtifactMembers(
    plan,
    turnScopeId,
    members,
  );
  const next = {
    count,
    conflicts: prior.conflicts + conflictDelta,
    attachments: prior.attachments + attachmentDelta,
  };
  if (
    Object.values(next).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    (count === 0 && (next.conflicts !== 0 || next.attachments !== 0))
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid display artifact transition");
  if (isDeepStrictEqual(prior, next)) return next;
  const key = sessionDisplayArtifactStateKey(turnScopeId);
  if (count === 0) plan.remove("metadata", key);
  else plan.set("metadata", key, next);
  return next;
}

async function stageRowDependencies(staged, previous, next) {
  for (const kind of Object.keys(previous.groups))
    await updateMembership(staged(kind), previous.groups[kind], next.groups[kind]);
  const ids = new Set([...previous.byId.keys(), ...next.byId.keys()]);
  const empty = new Set();
  for (const id of ids) {
    await updateMembership(
      staged("assistant", id),
      previous.byId.get(id) ?? empty,
      next.byId.get(id) ?? empty,
    );
    await updateMembership(
      staged("assistant-final", id),
      previous.finalById.get(id) ?? empty,
      next.finalById.get(id) ?? empty,
    );
  }
  return ids;
}

function includeLifecyclePresentations(ids, beforeState, afterState, userMembershipChanged) {
  const lifecycleChanged =
    beforeState.active !== afterState.active ||
    !isDeepStrictEqual(beforeState.lifecycle, afterState.lifecycle);
  if (!lifecycleChanged && !userMembershipChanged) return;
  for (const { lifecycle } of [beforeState, afterState])
    if (lifecycle !== null) ids.add(lifecycle.presentationMessageId);
}

export async function projectPartitionDisplayTurnTransition(plan, read, identity, transitions) {
  const stagedIdentity = { ...identity, generation: identity.generation + 1 };
  const beforeState = await readDisplayTurnState(read, identity);
  const afterState = await readDisplayTurnState(plan.readStaged, stagedIdentity);
  const before = changedSources(transitions, "before");
  const after = changedSources(transitions, "after");
  const previous = dependencies(before);
  const next = dependencies(after);
  const original = bindDirectories(plan, plan.read, identity.turnScopeId);
  const staged = bindDirectories(plan, plan.get, identity.turnScopeId);
  const ids = await stageRowDependencies(staged, previous, next);
  includeLifecyclePresentations(
    ids,
    beforeState,
    afterState,
    !isDeepStrictEqual(previous.groups.user, next.groups.user),
  );
  const beforeView = {
    read,
    identity,
    state: beforeState,
    directory: original,
    changed: before,
    ...previous,
  };
  const afterView = {
    read: plan.readStaged,
    identity: stagedIdentity,
    state: afterState,
    directory: staged,
    changed: after,
    ...next,
  };
  const projectBefore = () => projectAffectedRows(beforeView, ids);
  const projectAfter = () => projectAffectedRows(afterView, ids);
  let priorRows = await projectBefore();
  let nextRows = await projectAfter();
  const timelineChanged = !isDeepStrictEqual(previous.groups.timeline, next.groups.timeline);
  const artifactsChanged = previous.artifactCalls.size > 0 || next.artifactCalls.size > 0;
  const priorArtifacts =
    artifactsChanged || ids.size > 0
      ? await readArtifactState(plan.read, identity.turnScopeId)
      : emptyArtifactState;
  const { countDelta, members } = artifactsChanged
    ? await stageArtifactIndex(plan, identity.turnScopeId, beforeView, afterView)
    : { countDelta: 0, members: [] };
  const count = priorArtifacts.count + countDelta;
  const artifactsAffected = artifactsChanged || priorArtifacts.count > 0;
  const priorCount = assistantCount(priorRows);
  const nextCount = assistantCount(nextRows);
  const withoutArtifacts = (thinkingCountDelta) => ({
    before: { rows: priorRows, toolArtifactStats: emptyArtifactStats },
    after: { rows: nextRows, toolArtifactStats: emptyArtifactStats },
    thinkingCountDelta,
  });
  if (!artifactsAffected && !timelineChanged && priorCount === nextCount)
    return withoutArtifacts(0);
  const counts = await updateAssistantCount(plan, identity.turnScopeId, priorCount, nextCount);
  const thinkingCountDelta = await updateThinkingCount(original, staged, timelineChanged, counts);
  if (!artifactsAffected) return withoutArtifacts(thinkingCountDelta);
  const previousOwner = await readArtifactOwner(
    beforeView,
    priorArtifacts.count,
    () => counts.prior,
  );
  const nextOwner = await readArtifactOwner(afterView, count, () => counts.next);
  const size = ids.size;
  if (previousOwner !== null) ids.add(previousOwner);
  if (nextOwner !== null) ids.add(nextOwner);
  if (ids.size !== size) {
    priorRows = await projectBefore();
    nextRows = await projectAfter();
  }
  const baseBefore = ownerEnvelopes(priorRows, previousOwner);
  const baseAfter = ownerEnvelopes(nextRows, nextOwner);
  if (!isDeepStrictEqual(baseBefore, baseAfter))
    members.push({ before: baseBefore, after: baseAfter });
  const nextArtifacts = await stageArtifactState(plan, identity.turnScopeId, priorArtifacts, {
    count,
    members,
  });
  const previousArtifactStats = artifactStats(
    priorArtifacts,
    previousOwner,
    attachmentCount(baseBefore),
  );
  const nextArtifactStats = artifactStats(nextArtifacts, nextOwner, attachmentCount(baseAfter));
  return {
    before: { rows: priorRows, toolArtifactStats: previousArtifactStats },
    after: { rows: nextRows, toolArtifactStats: nextArtifactStats },
    thinkingCountDelta,
  };
}
