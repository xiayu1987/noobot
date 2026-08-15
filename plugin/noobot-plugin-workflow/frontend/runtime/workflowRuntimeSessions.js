/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { collectWorkflowDialogProcessIds, resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessId.js";

function normalizeRuntimeStatusInput(item = {}) {
  const canonical = item && typeof item === "object" ? item : {};
  return { ...canonical, status: String(canonical.status || "").trim() };
}

function makeNodeSessionFromRun(item = {}, workflowPayload) {
  const step = item?.step && typeof item.step === "object" ? item.step : {};
  const dialogProcessId = String(item?.nodeDialogProcessId || "").trim();
  return {
    transition: Number(item?.transition || 0),
    workflowRunId: String(item?.workflowRunId || "").trim(),
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
    status: String(item?.status || "").trim(),
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
    nodeId: String(item?.nodeId || "").trim(),
    nodeName: String(item?.nodeName || item?.nodeId || "").trim(),
    actionNodeStateId: String(item?.actionNodeStateId || item?.nodeStateId || "").trim(),
    stepId: String(item?.stepId || item?.nodeExecutionId || "").trim(),
    stepIndex: Number.isFinite(Number(item?.stepIndex)) ? Number(item.stepIndex) : undefined,
    commandId: String(item?.commandId || "").trim(),
    sessionId: String(item?.sessionId || item?.nodeSessionId || "").trim(),
    parentSessionId: String(item?.parentSessionId || "").trim(),
    dialogProcessId: String(item?.dialogProcessId || "").trim(),
    turnScopeId: String(item?.turnScopeId || "").trim(),
    activeChildExecutionId: String(item?.activeChildExecutionId || item?.childExecutionId || "").trim(),
    childExecutionId: String(item?.childExecutionId || item?.activeChildExecutionId || "").trim(),
    attemptExecutionIds: Array.isArray(item?.attemptExecutionIds) ? item.attemptExecutionIds.map(String) : [],
    status: String(item?.status || "").trim(),
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
  const canonicalBase = normalizeRuntimeStatusInput(base);
  const canonicalFact = normalizeRuntimeStatusInput(fact);
  const merged = {
    ...canonicalBase,
    ...canonicalFact,
    status: String(canonicalFact.status || canonicalBase.status || "").trim(),
    stepFailure: canonicalFact.stepFailure || canonicalBase.stepFailure || null,
  };
  if (!canonicalFact.sessionId) merged.sessionId = String(canonicalBase.sessionId || canonicalBase.nodeSessionId || "").trim();
  if (!canonicalFact.dialogProcessId) merged.dialogProcessId = String(canonicalBase.dialogProcessId || "").trim();
  if (!canonicalFact.turnScopeId) merged.turnScopeId = String(canonicalBase.turnScopeId || "").trim();
  if (!canonicalFact.nodeId) merged.nodeId = String(canonicalBase.nodeId || "").trim();
  if (!canonicalFact.nodeName) merged.nodeName = String(canonicalBase.nodeName || canonicalBase.nodeId || "").trim();
  if (!canonicalFact.actionNodeStateId) merged.actionNodeStateId = String(canonicalBase.actionNodeStateId || canonicalBase.nodeStateId || "").trim();
  if (!canonicalFact.stepId) merged.stepId = String(canonicalBase.stepId || "").trim();
  if (!canonicalFact.activeChildExecutionId) {
    merged.activeChildExecutionId = String(canonicalBase.activeChildExecutionId || canonicalBase.childExecutionId || "").trim();
  }
  if (!canonicalFact.childExecutionId) {
    merged.childExecutionId = String(canonicalBase.childExecutionId || canonicalBase.activeChildExecutionId || "").trim();
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
  ].map((value) => String(value || "").trim()).filter(Boolean);
  for (const key of keys) {
    if (entryIndexByKey.has(key)) return entryIndexByKey.get(key);
  }
  return -1;
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
      const canonicalItem = normalizeRuntimeStatusInput(item);
      const nodeExecutionId = String(canonicalItem?.nodeExecutionId || "").trim();
      const committed = nodeExecutionId ? normalizeCommittedNodeFact(committedNodes[nodeExecutionId]) : null;
      entries.push(committed?.nodeExecutionId ? mergeCommittedNodeFact(canonicalItem, committed) : canonicalItem);
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
