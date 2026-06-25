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

export function createRuntimeNodeSessions({ workflowPayload, nodeSessions, executionMeta }) {
  return computed(() => {
    const entries = [];
    const entryIndexByKey = new Map();

    for (const item of nodeSessions.value) {
      entries.push(item);
      rememberRuntimeEntryKeys(entryIndexByKey, item, entries.length - 1);
    }

    const runs = Array.isArray(executionMeta.value?.nodeAgentRuns)
      ? executionMeta.value.nodeAgentRuns
      : [];
    for (const runItem of runs) {
      const fallback = makeNodeSessionFromRun(runItem, workflowPayload);
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
