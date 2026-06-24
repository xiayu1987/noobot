/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_ACTION,
  WORKFLOW_PLUGIN_DEFAULTS,
} from "../constants.js";
import {
  advanceWorkflowInstance,
  createWorkflowInstance,
  releaseWorkflowInstance,
  resolveWorkflowUpstreamActionSteps,
} from "../../workflow/adapter.js";
import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import {
  getWorkflowTransferPayloadFromResult,
  resolveWorkflowAttachmentMetasFromTransferPayload,
} from "../hooks/attachments.js";
import {
  buildWorkflowUpstreamAttachmentResults,
  resolveSemanticNodeForPendingStep,
  resolveStepIndexForAction,
  resolveWorkflowInstanceId,
  runNodeAgent,
} from "../hooks/node-agent.js";
import {
  resolveSubSessionFinalOutput,
  stripHarnessReviewAppendix,
  truncateWorkflowResultText,
} from "../hooks/persistence.js";
import { resolveWorkflowNodeDialogProcessId } from "../dialog-process-compat.js";

function resolveWorkflowExecutionLimits(options = {}) {
  const maxTransitions = Number.isFinite(Number(options?.maxAutoTransitions))
    ? Math.max(1, Math.floor(Number(options.maxAutoTransitions)))
    : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS;
  const maxParallelNodeAgents = Number.isFinite(Number(options?.maxParallelNodeAgents))
    ? Math.max(1, Math.floor(Number(options.maxParallelNodeAgents)))
    : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS;
  return {
    maxTransitions,
    maxParallelNodeAgents,
    parallelEnabled: options?.parallelNodeExecution === true,
  };
}

function resolveNodeResultAttachmentMetas(item = {}, ctx = {}) {
  const transferMetas = resolveWorkflowAttachmentMetasFromTransferPayload(
    getWorkflowTransferPayloadFromResult(item?.subSession?.result || {}),
    ctx,
  );
  if (transferMetas.length) return transferMetas;
  return Array.isArray(item?.subSession?.result?.attachmentMetas)
    ? item.subSession.result.attachmentMetas
    : [];
}

function resolveItemStepFailure(item = {}) {
  const candidates = [item?.effectiveAction, item?.action];
  for (const action of candidates) {
    const failure = action?.stepFailure;
    if (failure && typeof failure === "object") return failure;
    const message = String(failure || "").trim();
    if (message) return { message };
  }
  return null;
}

function buildNodeAgentRunRecord({
  item = {},
  snapshot = {},
  transitions = 0,
  parallelEnabled = false,
  waveSize = 1,
  ctx = {},
} = {}) {
  const resultTransferPayload = getWorkflowTransferPayloadFromResult(item?.subSession?.result || {});
  const stepFailure = resolveItemStepFailure(item);
  return {
    transition: transitions,
    step: item?.step || null,
    action: item?.effectiveAction || item?.action || null,
    nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(item),
    nodeSessionId: String(item?.subSession?.sessionId || "").trim(),
    nodeSessionPersistedPath: String(item?.subSession?.persisted?.outputDir || "").trim(),
    actionNodeStateId: String(item?.step?.actionNodeStateId || "").trim(),
    stepId: String(item?.step?.stepId || "").trim(),
    stepIndex: Number.isFinite(Number(item?.step?.stepIndex))
      ? Number(item.step.stepIndex)
      : -1,
    nodeResultText: truncateWorkflowResultText(
      stripHarnessReviewAppendix(
        resolveSubSessionFinalOutput(item?.subSession || {}),
      ),
      4000,
    ),
    nodeResultAttachmentMetas: resolveNodeResultAttachmentMetas(item, ctx),
    nodeResultTransferEnvelopes: resultTransferPayload.transferEnvelopes,
    nodeResultTransferResult: resultTransferPayload.transferResult,
    // Persist an explicit terminal status for every executed node step.
    // The workflow card is rendered again from the saved session message after a page refresh;
    // relying on the presence of session/dialog ids to infer success makes the persisted payload
    // non-self-describing and can make refreshed graph nodes fall back to pending.
    stepStatus: stepFailure ? "failed" : "success",
    stepFailure,
    upstreamNodeResults: Array.isArray(item?.upstreamNodeResults)
      ? item.upstreamNodeResults
      : [],
    parallelWave: parallelEnabled ? Math.floor((transitions - 1) / Math.max(1, waveSize)) + 1 : 0,
    waveOrder: Number(item?.order ?? 0),
    pendingStepCount: Number(snapshot?.pendingStepCount || 0),
  };
}

function rememberCompletedStepResult({
  completedStepResults,
  item = {},
  semantic = {},
  transitions = 0,
  ctx = {},
} = {}) {
  const completedStepId = String(item?.step?.stepId || "").trim();
  if (!completedStepId) return;

  const completedSemanticNode = resolveSemanticNodeForPendingStep({
    semantic,
    pendingStep: item?.step || {},
  });
  const completedNodeId = String(
    item?.step?.nodeId || completedSemanticNode?.id || "",
  ).trim();
  const completedNodeTask = String(
    item?.step?.nodeTask ||
      completedSemanticNode?.task ||
      completedSemanticNode?.taskText ||
      completedSemanticNode?.instruction ||
      completedSemanticNode?.mission ||
      "",
  ).trim();
  const resultTransferPayload = getWorkflowTransferPayloadFromResult(item?.subSession?.result || {});
  const stepFailure = resolveItemStepFailure(item);
  completedStepResults.set(completedStepId, {
    transition: transitions,
    nodeId: completedNodeId,
    nodeName: String(
      item?.step?.nodeName || completedSemanticNode?.name || completedNodeId,
    ).trim(),
    nodeTask: completedNodeTask,
    actionNodeStateId: String(item?.step?.actionNodeStateId || "").trim(),
    stepId: completedStepId,
    stepIndex: Number.isFinite(Number(item?.step?.stepIndex))
      ? Number(item.step.stepIndex)
      : -1,
    nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(item),
    nodeSessionId: String(item?.subSession?.sessionId || "").trim(),
    stepStatus: stepFailure ? "failed" : "success",
    stepFailure,
    attachmentMetas: resolveNodeResultAttachmentMetas(item, ctx),
    transferEnvelopes: resultTransferPayload.transferEnvelopes,
    transferResult: resultTransferPayload.transferResult,
  });
}

export async function runWorkflowExecution({
  hookManager,
  options = {},
  ctx = {},
  semantic = {},
} = {}) {
  const instanceId = resolveWorkflowInstanceId(ctx);
  let snapshot = createWorkflowInstance({
    instanceId,
    semantic,
    options,
    meta: {
      userId: String(ctx?.userId || "").trim(),
      sessionId: String(ctx?.sessionId || "").trim(),
      dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    },
  });
  const { maxTransitions, maxParallelNodeAgents, parallelEnabled } =
    resolveWorkflowExecutionLimits(options);
  const nodeAgentRuns = [];
  const completedStepResults = new Map();
  let transitions = 0;

  while (snapshot && snapshot.completed !== true && transitions < maxTransitions) {
    throwIfWorkflowAborted(ctx);
    const pending = Array.isArray(snapshot.pendingSteps) ? snapshot.pendingSteps : [];
    if (!pending.length) break;
    const waveSize = parallelEnabled ? Math.min(maxParallelNodeAgents, pending.length) : 1;
    const waveSteps = pending.slice(0, waveSize);
    const waveResults = await Promise.all(
      waveSteps.map(async (step, idx) => {
        throwIfWorkflowAborted(ctx);
        const upstreamActionSteps = resolveWorkflowUpstreamActionSteps({
          instanceId,
          pendingStep: step,
        });
        const upstreamNodeResults = buildWorkflowUpstreamAttachmentResults({
          upstreamActionSteps,
          completedStepResults,
        });
        const action = await runNodeAgent({
          hookManager,
          options,
          ctx,
          instanceId,
          pendingStep: step,
          semantic,
          transition: transitions + idx + 1,
          upstreamNodeResults,
        });
        throwIfWorkflowAborted(ctx);
        return {
          step,
          action: action?.action || null,
          subSession: action?.subSession || null,
          nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(action),
          upstreamNodeResults,
          order: idx,
        };
      }),
    );
    throwIfWorkflowAborted(ctx);
    // Execute higher index first to keep original stepIndex semantics in the same parallel batch.
    const actionQueue = waveResults
      .slice()
      .sort((a, b) => Number(b?.step?.index || 0) - Number(a?.step?.index || 0));
    for (const item of actionQueue) {
      throwIfWorkflowAborted(ctx);
      if (!snapshot || snapshot.completed === true || transitions >= maxTransitions) break;
      const resolvedStepIndex = resolveStepIndexForAction({
        snapshot,
        preferredIndex: item?.action?.stepIndex ?? item?.step?.index ?? 0,
        pendingStep: item?.step || {},
      });
      const effectiveAction = {
        type: String(item?.action?.type || WORKFLOW_ACTION.SUBMIT).trim().toLowerCase(),
        stepIndex: resolvedStepIndex,
        ...(item?.action?.stepFailure && typeof item.action.stepFailure === "object"
          ? { stepFailure: item.action.stepFailure }
          : {}),
      };
      snapshot = advanceWorkflowInstance({
        instanceId,
        action: effectiveAction,
      });
      transitions += 1;
      const recordItem = { ...item, effectiveAction };
      nodeAgentRuns.push(
        buildNodeAgentRunRecord({
          item: recordItem,
          snapshot,
          transitions,
          parallelEnabled,
          waveSize,
          ctx,
        }),
      );
      rememberCompletedStepResult({
        completedStepResults,
        item,
        semantic,
        transitions,
        ctx,
      });
    }
  }
  throwIfWorkflowAborted(ctx);
  const execution = {
    started: true,
    instanceId,
    autoTransitions: transitions,
    completed: snapshot?.completed === true,
    pendingStepCount: Number(snapshot?.pendingStepCount || 0),
    actionRecords: Array.isArray(snapshot?.actionRecords) ? snapshot.actionRecords : [],
    nodeAgentRuns,
  };
  if (execution.completed) {
    releaseWorkflowInstance({ instanceId });
  }
  return {
    execution,
    nodeAgentRuns,
    instanceId,
  };
}
