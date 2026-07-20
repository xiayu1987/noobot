/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { computed } from "vue";
import { collectWorkflowDialogProcessIds, resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";

function makeNodeSessionFromRun(item = {}, workflowPayload) {
  const step = item?.step && typeof item.step === "object" ? item.step : {};
  const dialogProcessId = resolveWorkflowDialogProcessId(item, step);
  return {
    transition: Number(item?.transition || 0),
    workflowRunId: String(item?.workflowRunId || workflowPayload.value?.workflowRunId || "").trim(),
    nodeExecutionId: String(item?.nodeExecutionId || "").trim(),
    commandId: String(item?.commandId || "").trim(),
    parentSessionId: String(item?.parentSessionId || "").trim(),
    nodeName: String(step?.nodeName || item?.nodeName || "").trim(),
    nodeId: String(step?.nodeId || item?.nodeId || "").trim(),
    nodeType: Number.isFinite(Number(step?.nodeType ?? item?.nodeType))
      ? Number(step?.nodeType ?? item?.nodeType)
      : undefined,
    actionNodeStateId: String(item?.actionNodeStateId || step?.actionNodeStateId || "").trim(),
    stepId: String(item?.stepId || step?.stepId || "").trim(),
    stepIndex: Number.isFinite(Number(item?.stepIndex ?? step?.stepIndex))
      ? Number(item?.stepIndex ?? step?.stepIndex)
      : undefined,
    type: String(step?.type || item?.type || "").trim(),
    stateType: Number.isFinite(Number(step?.stateType ?? item?.stateType))
      ? Number(step?.stateType ?? item?.stateType)
      : undefined,
    rootSessionId: String(
      item?.rootSessionId ||
        workflowPayload.value?.planningDialog?.sessionId ||
        workflowPayload.value?.runMeta?.sessionId ||
        "",
    ).trim(),
    dialogProcessId,
    sessionId: String(item?.nodeSessionId || item?.sessionId || "").trim(),
    transferEnvelopes: Array.isArray(item?.nodeResultTransferEnvelopes)
      ? item.nodeResultTransferEnvelopes
      : Array.isArray(item?.transferEnvelopes)
        ? item.transferEnvelopes
        : [],
    stepStatus: String(item?.stepStatus || item?.status || "").trim(),
    stepFailure:
      item?.stepFailure && typeof item.stepFailure === "object"
        ? item.stepFailure
        : null,
    parallelWave: Number(item?.parallelWave || 0),
    waveOrder: Number(item?.waveOrder || 0),
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

function normalizeCommittedNodeFact(item = {}) {
  return {
    workflowRunId: String(item?.workflowRunId || "").trim(),
    nodeExecutionId: String(item?.nodeExecutionId || "").trim(),
    commandId: String(item?.commandId || "").trim(),
    sessionId: String(item?.sessionId || item?.nodeSessionId || "").trim(),
    parentSessionId: String(item?.parentSessionId || "").trim(),
    dialogProcessId: String(item?.dialogProcessId || item?.nodeDialogProcessId || "").trim(),
    turnScopeId: String(item?.turnScopeId || "").trim(),
    activeChildExecutionId: String(item?.activeChildExecutionId || item?.childExecutionId || "").trim(),
    attemptExecutionIds: Array.isArray(item?.attemptExecutionIds) ? item.attemptExecutionIds.map(String) : [],
    status: String(item?.status || item?.stepStatus || "").trim(),
    stepStatus: String(item?.stepStatus || item?.status || "").trim(),
    stepFailure: item?.failure && typeof item.failure === "object"
      ? item.failure
      : item?.stepFailure && typeof item.stepFailure === "object"
        ? item.stepFailure
        : null,
    revision: Number(item?.revision || 0),
    sequence: Number(item?.sequence || 0),
    eventId: String(item?.eventId || "").trim(),
    updatedAt: String(item?.updatedAt || item?.occurredAt || "").trim(),
  };
}

function mergeCommittedNodeFact(base = {}, fact = {}) {
  if (!fact?.nodeExecutionId) return base;
  const merged = {
    ...base,
    ...fact,
    stepStatus: String(fact.stepStatus || fact.status || base.stepStatus || base.status || "").trim(),
    stepFailure: fact.stepFailure || base.stepFailure || null,
  };
  if (!fact.sessionId) merged.sessionId = String(base.sessionId || base.nodeSessionId || "").trim();
  if (!fact.dialogProcessId) merged.dialogProcessId = String(base.dialogProcessId || base.nodeDialogProcessId || "").trim();
  if (!fact.turnScopeId) merged.turnScopeId = String(base.turnScopeId || "").trim();
  return merged;
}

function makeRuntimeEntryKey(item = {}) {
  return String(
    item?.dialogProcessId ||
      item?.nodeDialogProcessId ||
      item?.sessionId ||
      item?.nodeSessionId ||
      item?.stepId ||
      item?.actionNodeStateId ||
      resolveWorkflowDialogProcessId(item) ||
      "",
  ).trim();
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

function mergeRuntimeEntry(base = {}, fallback = {}) {
  return {
    ...fallback,
    ...base,
    stepStatus: String(base?.stepStatus || base?.status || fallback?.stepStatus || fallback?.status || "").trim(),
    stepFailure:
      base?.stepFailure && typeof base.stepFailure === "object"
        ? base.stepFailure
        : fallback?.stepFailure && typeof fallback.stepFailure === "object"
          ? fallback.stepFailure
          : null,
  };
}

export function createRuntimeNodeSessions({ workflowPayload, nodeSessions, executionMeta, workflowNodeStateRegistry = null }) {
  return computed(() => {
    const entries = [];
    const entryIndexByKey = new Map();
    const workflowRunId = resolveWorkflowRunId(workflowPayload);
    const registry = getRegistryValue(workflowNodeStateRegistry);
    const committedNodes = workflowRunId
      ? registry?.workflows?.[workflowRunId]?.nodes || {}
      : {};

    for (const item of nodeSessions.value) {
      const nodeExecutionId = String(item?.nodeExecutionId || "").trim();
      const committed = nodeExecutionId ? normalizeCommittedNodeFact(committedNodes[nodeExecutionId]) : null;
      entries.push(committed?.nodeExecutionId ? mergeCommittedNodeFact(item, committed) : item);
      rememberRuntimeEntryKeys(entryIndexByKey, item, entries.length - 1);
    }

    for (const committedItem of Object.values(committedNodes)) {
      const committed = normalizeCommittedNodeFact(committedItem);
      if (!committed.nodeExecutionId) continue;
      const key = `node:${committed.nodeExecutionId}`;
      if (entryIndexByKey.has(key)) {
        const index = entryIndexByKey.get(key);
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
      if (fallback.nodeExecutionId && workflowRunId && fallback.workflowRunId === workflowRunId) {
        const key = `node:${fallback.nodeExecutionId}`;
        if (entryIndexByKey.has(key)) continue;
      }
      if (!fallback.dialogProcessId && !fallback.sessionId && !fallback.stepId) continue;

      const key = makeRuntimeEntryKey(fallback);
      if (key && entryIndexByKey.has(key)) {
        const index = entryIndexByKey.get(key);
        entries[index] = mergeRuntimeEntry(entries[index], fallback);
        rememberRuntimeEntryKeys(entryIndexByKey, entries[index], index);
        continue;
      }

      entries.push(fallback);
      rememberRuntimeEntryKeys(entryIndexByKey, fallback, entries.length - 1);
    }

    return entries;
  });
}
