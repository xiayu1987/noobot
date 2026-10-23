/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { collectWorkflowDialogProcessIds } from "../utils/workflowDialogProcessId.js";
import { firstText, text } from "@noobot/shared/value";

function normalizeRuntimeStatusInput(item = {}) {
  const canonical = item && typeof item === "object" ? item : {};
  return { ...canonical, status: text(canonical.status) };
}

function objectOr(value, fallback) {
  return value && typeof value === "object" ? value : fallback;
}

function finiteNumberFrom(value) {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function normalizeCommittedNodeFact(item = {}) {
  const source = objectOr(item, {});
  return {
    workflowRunId: firstText(source.workflowRunId),
    nodeExecutionId: firstText(source.nodeExecutionId),
    nodeId: firstText(source.nodeId),
    nodeName: firstText(source.nodeName, source.nodeId),
    actionNodeStateId: firstText(source.actionNodeStateId),
    stepId: firstText(source.stepId, source.nodeExecutionId),
    stepIndex: finiteNumberFrom(source.stepIndex),
    commandId: firstText(source.commandId),
    sessionId: firstText(source.nodeSessionId),
    parentSessionId: firstText(source.parentSessionId),
    dialogProcessId: firstText(source.dialogProcessId),
    turnScopeId: firstText(source.turnScopeId),
    activeChildExecutionId: firstText(source.activeChildExecutionId),
    attemptExecutionIds: Array.isArray(source.attemptExecutionIds)
      ? source.attemptExecutionIds.map(String)
      : [],
    status: firstText(source.status),
    stepFailure: objectOr(source.failure, objectOr(source.stepFailure, null)),
    revision: Number(source.revision || 0),
    sequence: Number(source.sequence || 0),
    eventId: firstText(source.eventId),
    updatedAt: firstText(source.updatedAt, source.occurredAt),
  };
}

const BASE_FALLBACK_FIELDS = [
  ["sessionId", "sessionId"],
  ["dialogProcessId", "dialogProcessId"],
  ["turnScopeId", "turnScopeId"],
  ["nodeId", "nodeId"],
  ["nodeName", "nodeName", "nodeId"],
  ["actionNodeStateId", "actionNodeStateId"],
  ["stepId", "stepId"],
  ["activeChildExecutionId", "activeChildExecutionId"],
];

function mergeCommittedNodeFact(base = {}, fact = {}) {
  if (!fact?.nodeExecutionId) return base;
  const canonicalBase = normalizeRuntimeStatusInput(base);
  const canonicalFact = normalizeRuntimeStatusInput(fact);
  const merged = {
    ...canonicalBase,
    ...canonicalFact,
    status: firstText(canonicalFact.status, canonicalBase.status),
    stepFailure: canonicalFact.stepFailure || canonicalBase.stepFailure || null,
  };
  for (const [field, ...fallbacks] of BASE_FALLBACK_FIELDS) {
    if (!canonicalFact[field])
      merged[field] = firstText(...fallbacks.map((key) => canonicalBase[key]));
  }
  return merged;
}

function rememberRuntimeEntryKeys(entryIndexByKey, item = {}, index = 0) {
  const keys = [
    item?.nodeExecutionId ? `node:${item.nodeExecutionId}` : "",
    ...collectWorkflowDialogProcessIds(item),
    item?.sessionId,
    item?.nodeSessionId,
    item?.stepId,
    item?.actionNodeStateId,
  ]
    .map((value) => text(value))
    .filter(Boolean);
  for (const key of keys) {
    if (!entryIndexByKey.has(key)) entryIndexByKey.set(key, index);
  }
}

function findRuntimeEntryIndex(entryIndexByKey, item = {}) {
  const keys = [
    item?.nodeExecutionId ? `node:${item.nodeExecutionId}` : "",
    ...collectWorkflowDialogProcessIds(item),
    item?.sessionId,
    item?.nodeSessionId,
    item?.stepId,
    item?.actionNodeStateId,
  ]
    .map((value) => text(value))
    .filter(Boolean);
  for (const key of keys) {
    if (entryIndexByKey.has(key)) return entryIndexByKey.get(key);
  }
  return -1;
}

export function createRuntimeNodeSessions({
  workflowPayload,
  nodeSessions,
  workflowNodeStateRegistry = null,
}) {
  return computed(() => {
    const entries = [];
    const entryIndexByKey = new Map();
    const workflowRunId = text(workflowPayload.value?.workflowRunId);
    const committedNodes = workflowRunId
      ? workflowNodeStateRegistry?.workflows?.[workflowRunId]?.nodes || {}
      : {};

    for (const item of nodeSessions.value) {
      const canonicalItem = normalizeRuntimeStatusInput(item);
      const nodeExecutionId = text(canonicalItem?.nodeExecutionId);
      const committed = nodeExecutionId
        ? normalizeCommittedNodeFact(committedNodes[nodeExecutionId])
        : null;
      entries.push(
        committed?.nodeExecutionId
          ? mergeCommittedNodeFact(canonicalItem, committed)
          : canonicalItem,
      );
      rememberRuntimeEntryKeys(entryIndexByKey, canonicalItem, entries.length - 1);
    }

    for (const committedItem of Object.values(committedNodes)) {
      const committed = normalizeCommittedNodeFact(committedItem);
      if (!committed.nodeExecutionId) continue;
      const index = findRuntimeEntryIndex(entryIndexByKey, committed);
      if (index >= 0) {
        entries[index] = mergeCommittedNodeFact(entries[index], committed);
        rememberRuntimeEntryKeys(entryIndexByKey, entries[index], index);
        continue;
      }
      entries.push(committed);
      rememberRuntimeEntryKeys(entryIndexByKey, committed, entries.length - 1);
    }

    return entries;
  });
}
