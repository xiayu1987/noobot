/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import {
  NODE_RESULT_FIRST_FIELDS,
  pickTransferEnvelopeList,
} from "@noobot/semantic-transfer-protocol";
import { collectWorkflowDialogProcessIds } from "../utils/workflowDialogProcessId.js";

function normalizeRuntimeStatusInput(item = {}) {
  const canonical = item && typeof item === "object" ? item : {};
  return { ...canonical, status: String(canonical.status || "").trim() };
}

function objectOr(value, fallback) {
  return value && typeof value === "object" ? value : fallback;
}

function firstText(...values) {
  return String(values.find(Boolean) || "").trim();
}

function finiteNumberOrUndefined(primary, fallback) {
  const value = Number(primary ?? fallback);
  return Number.isFinite(value) ? value : undefined;
}

function resolveNodeRootSessionId(source, workflowPayload) {
  if (source.rootSessionId) return firstText(source.rootSessionId);
  const payload = workflowPayload.value;
  return firstText(payload?.planningDialog?.sessionId, payload?.runMeta?.sessionId);
}

function makeNodeSessionFromRun(item = {}, workflowPayload) {
  const source = objectOr(item, {});
  const step = objectOr(source.step, {});
  return {
    transition: Number(source.transition || 0),
    workflowRunId: firstText(source.workflowRunId),
    nodeExecutionId: firstText(source.nodeExecutionId),
    commandId: firstText(source.commandId),
    parentSessionId: firstText(source.parentSessionId),
    nodeName: firstText(step.nodeName, source.nodeName),
    nodeId: firstText(step.nodeId, source.nodeId),
    nodeType: finiteNumberOrUndefined(step.nodeType, source.nodeType),
    actionNodeStateId: firstText(source.actionNodeStateId, step.actionNodeStateId),
    stepId: firstText(source.stepId, step.stepId),
    stepIndex: finiteNumberOrUndefined(source.stepIndex, step.stepIndex),
    type: firstText(step.type, source.type),
    stateType: finiteNumberOrUndefined(step.stateType, source.stateType),
    rootSessionId: resolveNodeRootSessionId(source, workflowPayload),
    dialogProcessId: firstText(source.nodeDialogProcessId),
    sessionId: firstText(source.nodeSessionId, source.sessionId),
    transferEnvelopes: pickTransferEnvelopeList(item, NODE_RESULT_FIRST_FIELDS, {
      skipEmpty: false,
    }),
    status: firstText(source.status),
    stepFailure: objectOr(source.stepFailure, null),
    parallelWave: Number(source.parallelWave || 0),
    waveOrder: Number(source.waveOrder || 0),
  };
}

function getRegistryValue(registry) {
  if (registry && typeof registry === "object" && "value" in registry) return registry.value || {};
  return registry && typeof registry === "object" ? registry : {};
}

function resolveWorkflowRunId(workflowPayload) {
  return String(
    workflowPayload.value?.workflowRunId ||
      workflowPayload.value?.execution?.workflowRunId ||
      workflowPayload.value?.execution?.instanceId ||
      "",
  ).trim();
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
    actionNodeStateId: firstText(source.actionNodeStateId, source.nodeStateId),
    stepId: firstText(source.stepId, source.nodeExecutionId),
    stepIndex: finiteNumberFrom(source.stepIndex),
    commandId: firstText(source.commandId),
    sessionId: firstText(source.sessionId, source.nodeSessionId),
    parentSessionId: firstText(source.parentSessionId),
    dialogProcessId: firstText(source.dialogProcessId),
    turnScopeId: firstText(source.turnScopeId),
    activeChildExecutionId: firstText(source.activeChildExecutionId, source.childExecutionId),
    childExecutionId: firstText(source.childExecutionId, source.activeChildExecutionId),
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
  ["sessionId", "sessionId", "nodeSessionId"],
  ["dialogProcessId", "dialogProcessId"],
  ["turnScopeId", "turnScopeId"],
  ["nodeId", "nodeId"],
  ["nodeName", "nodeName", "nodeId"],
  ["actionNodeStateId", "actionNodeStateId", "nodeStateId"],
  ["stepId", "stepId"],
  ["activeChildExecutionId", "activeChildExecutionId", "childExecutionId"],
  ["childExecutionId", "childExecutionId", "activeChildExecutionId"],
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
    .map((value) => String(value || "").trim())
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
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const key of keys) {
    if (entryIndexByKey.has(key)) return entryIndexByKey.get(key);
  }
  return -1;
}

export function createRuntimeNodeSessions({
  workflowPayload,
  nodeSessions,
  executionMeta,
  workflowNodeStateRegistry = null,
}) {
  return computed(() => {
    const entries = [];
    const entryIndexByKey = new Map();
    const workflowRunId = resolveWorkflowRunId(workflowPayload);
    const registry = getRegistryValue(workflowNodeStateRegistry);
    const committedNodes = workflowRunId ? registry?.workflows?.[workflowRunId]?.nodes || {} : {};

    for (const item of nodeSessions.value) {
      const canonicalItem = normalizeRuntimeStatusInput(item);
      const nodeExecutionId = String(canonicalItem?.nodeExecutionId || "").trim();
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

    const runs = Array.isArray(executionMeta.value?.nodeAgentRuns)
      ? executionMeta.value.nodeAgentRuns
      : [];
    for (const runItem of runs) {
      const fallback = makeNodeSessionFromRun(runItem, workflowPayload);
      if (!fallback.nodeExecutionId || !workflowRunId || fallback.workflowRunId !== workflowRunId) {
        continue;
      }
      const nodeKey = `node:${fallback.nodeExecutionId}`;
      if (entryIndexByKey.has(nodeKey)) continue;

      entries.push(fallback);
      rememberRuntimeEntryKeys(entryIndexByKey, fallback, entries.length - 1);
    }

    return entries;
  });
}
