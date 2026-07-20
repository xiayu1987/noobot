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
import { isWorkflowAbortError, throwIfWorkflowAborted } from "../hooks/runtime.js";
import {
  getWorkflowTransferPayloadFromResult,
  resolveWorkflowAttachmentsFromTransferPayload,
} from "../hooks/attachments.js";
import {
  buildWorkflowUpstreamAttachmentResults,
  resolveSemanticNodeForPendingStep,
  resolveStepIndexForAction,
  resolveWorkflowInstanceId,
  runNodeAgent,
} from "../hooks/node-agent.js";
import {
  emitWorkflowRuntimeEvent,
  resolveSubSessionFinalOutput,
  stripHarnessReviewAppendix,
  truncateWorkflowResultText,
} from "../hooks/persistence.js";
import { resolveWorkflowNodeDialogProcessId } from "../dialog-process-compat.js";
import {
  resolveWorkflowNodeStateRepository,
  WORKFLOW_NODE_STATUS,
} from "./node-state-repository.js";

function resolvePlanningNodeIdentity({ planningNodeSessions = [], pendingStep = {} } = {}) {
  const nodeId = String(pendingStep?.nodeId || pendingStep?.id || "").trim();
  if (!nodeId || !Array.isArray(planningNodeSessions) || !planningNodeSessions.length) return null;
  const attempt = Math.max(1, Math.floor(Number(pendingStep?.attempt || pendingStep?.attemptIndex || 1) || 1));
  const matches = planningNodeSessions.filter((item = {}) => {
    const itemNodeId = String(item?.nodeId || "").trim();
    const itemAttempt = Math.max(1, Math.floor(Number(item?.attempt || 1) || 1));
    return itemNodeId === nodeId && itemAttempt === attempt;
  });
  if (matches.length !== 1) {
    throw new Error(
      matches.length > 1
        ? `duplicate workflow node identity for ${nodeId} attempt ${attempt}`
        : `missing workflow node identity for ${nodeId} attempt ${attempt}`,
    );
  }
  const identity = matches[0] || {};
  const requiredFields = ["workflowRunId", "nodeExecutionId", "commandId", "dialogProcessId", "turnScopeId"];
  const missingFields = requiredFields.filter((field) => !String(identity?.[field] || "").trim());
  if (missingFields.length) {
    throw new Error(
      `incomplete workflow node identity for ${nodeId} attempt ${attempt}: ${missingFields.join(",")}`,
    );
  }
  return identity;
}

async function publishWorkflowNodeStateCommitted({ options = {}, ctx = {}, fact = null } = {}) {
  const node = fact?.node && typeof fact.node === "object" ? fact.node : null;
  if (!node) return null;
  const event = "workflow_node_state_committed";
  const data = {
    workflowRunId: node.workflowRunId,
    nodeExecutionId: node.nodeExecutionId,
    commandId: node.commandId,
    sessionId: node.sessionId,
    parentSessionId: node.parentSessionId,
    dialogProcessId: node.dialogProcessId,
    turnScopeId: node.turnScopeId,
    nodeId: node.nodeId,
    nodeName: node.nodeName,
    status: node.status,
    revision: node.revision,
    sequence: node.sequence,
    eventId: node.eventId,
    failure: node.failure,
    startedAt: node.startedAt,
    completedAt: node.completedAt,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    applied: fact.applied === true,
    deduplicated: fact.deduplicated === true,
  };
  let persisted = null;
  let realtime = null;
  try {
    persisted = await emitWorkflowRuntimeEvent({ options, ctx, event, data });
  } catch {
    persisted = null;
  }
  try {
    if (typeof ctx?.eventListener?.onEvent === "function") {
      realtime = await ctx.eventListener.onEvent({ event, data });
    }
  } catch {
    realtime = null;
  }
  return { persisted, realtime, event, data };
}

async function commitAndPublishWorkflowNodeState({
  repository,
  options = {},
  ctx = {},
  workflowRunId = "",
  nodeExecutionId = "",
  status = "",
  expectedRevision = null,
  sessionId = "",
  failure = null,
} = {}) {
  const fact = await repository.commit({
    workflowRunId,
    nodeExecutionId,
    status,
    expectedRevision,
    sessionId,
    failure,
  });
  if (fact?.applied === true) {
    await publishWorkflowNodeStateCommitted({ options, ctx, fact });
  }
  return fact;
}

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

function resolveNodeResultAttachments(item = {}, ctx = {}) {
  const transferAttachments = resolveWorkflowAttachmentsFromTransferPayload(
    getWorkflowTransferPayloadFromResult(item?.subSession?.result || {}),
    ctx,
  );
  if (transferAttachments.length) return transferAttachments;
  return Array.isArray(item?.subSession?.result?.attachments) ? item.subSession.result.attachments : [];
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
    workflowRunId: String(item?.nodeIdentity?.workflowRunId || "").trim(),
    nodeExecutionId: String(item?.nodeIdentity?.nodeExecutionId || "").trim(),
    commandId: String(item?.nodeIdentity?.commandId || "").trim(),
    turnScopeId: String(item?.nodeIdentity?.turnScopeId || "").trim(),
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
    nodeResultAttachments: resolveNodeResultAttachments(item, ctx),
    nodeResultTransferEnvelopes: resultTransferPayload.transferEnvelopes,
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
    workflowRunId: String(item?.nodeIdentity?.workflowRunId || "").trim(),
    nodeExecutionId: String(item?.nodeIdentity?.nodeExecutionId || "").trim(),
    commandId: String(item?.nodeIdentity?.commandId || "").trim(),
    turnScopeId: String(item?.nodeIdentity?.turnScopeId || "").trim(),
    nodeSessionId: String(item?.subSession?.sessionId || "").trim(),
    stepStatus: stepFailure ? "failed" : "success",
    stepFailure,
    attachments: resolveNodeResultAttachments(item, ctx),
    transferEnvelopes: resultTransferPayload.transferEnvelopes,
  });
}

export async function runWorkflowExecution({
  hookManager,
  options = {},
  ctx = {},
  semantic = {},
  workflowRunId = "",
  planningNodeSessions = [],
} = {}) {
  const instanceId = workflowRunId || resolveWorkflowInstanceId(ctx);
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
  const nodeStateRepository = Array.isArray(planningNodeSessions) && planningNodeSessions.length
    ? resolveWorkflowNodeStateRepository(options)
    : null;
  let nodeStateSnapshot = nodeStateRepository
    ? await nodeStateRepository.initialize({ workflowRunId: instanceId, planningNodeSessions })
    : null;
  let transitions = 0;

  while (snapshot && snapshot.completed !== true && transitions < maxTransitions) {
    throwIfWorkflowAborted(ctx);
    const pending = Array.isArray(snapshot.pendingSteps) ? snapshot.pendingSteps : [];
    if (!pending.length) break;
    const waveSize = parallelEnabled ? Math.min(maxParallelNodeAgents, pending.length) : 1;
    const waveSteps = pending.slice(0, waveSize);
    const settledWaveResults = await Promise.allSettled(
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
        const nodeIdentity = resolvePlanningNodeIdentity({ planningNodeSessions, pendingStep: step });
        const currentNodeState = nodeStateSnapshot?.nodes?.find?.(
          (node) => String(node?.nodeExecutionId || "").trim() === String(nodeIdentity?.nodeExecutionId || "").trim(),
        ) || null;
        let runningFact = null;
        if (nodeStateRepository && nodeIdentity) {
          runningFact = await commitAndPublishWorkflowNodeState({
            repository: nodeStateRepository,
            options,
            ctx,
            workflowRunId: nodeIdentity.workflowRunId,
            nodeExecutionId: nodeIdentity.nodeExecutionId,
            status: WORKFLOW_NODE_STATUS.RUNNING,
            expectedRevision: currentNodeState?.revision ?? null,
          });
          nodeStateSnapshot = runningFact?.snapshot || nodeStateSnapshot;
        }
        let action = null;
        try {
          action = await runNodeAgent({
            hookManager,
            options,
            ctx,
            instanceId,
            pendingStep: step,
            semantic,
            nodeIdentity,
            transition: transitions + idx + 1,
            upstreamNodeResults,
          });
          throwIfWorkflowAborted(ctx);
          if (nodeStateRepository && nodeIdentity) {
            const terminalFact = await commitAndPublishWorkflowNodeState({
              repository: nodeStateRepository,
              options,
              ctx,
              workflowRunId: nodeIdentity.workflowRunId,
              nodeExecutionId: nodeIdentity.nodeExecutionId,
              status: WORKFLOW_NODE_STATUS.SUCCEEDED,
              expectedRevision: runningFact?.node?.revision ?? null,
              sessionId: action?.subSession?.sessionId || "",
            });
            nodeStateSnapshot = terminalFact?.snapshot || nodeStateSnapshot;
          }
        } catch (error) {
          if (nodeStateRepository && nodeIdentity && runningFact?.node) {
            const stopped = isWorkflowAbortError(error, ctx);
            const terminalFact = await commitAndPublishWorkflowNodeState({
              repository: nodeStateRepository,
              options,
              ctx,
              workflowRunId: nodeIdentity.workflowRunId,
              nodeExecutionId: nodeIdentity.nodeExecutionId,
              status: stopped ? WORKFLOW_NODE_STATUS.STOPPED : WORKFLOW_NODE_STATUS.FAILED,
              expectedRevision: runningFact.node.revision,
              sessionId: action?.subSession?.sessionId || "",
              failure: {
                name: error?.name || "Error",
                code: error?.code || "",
                message: error?.message || String(error || "workflow node failed"),
              },
            });
            nodeStateSnapshot = terminalFact?.snapshot || nodeStateSnapshot;
          }
          throw error;
        }
        return {
          step,
          action: action?.action || null,
          subSession: action?.subSession || null,
          nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(action),
          nodeIdentity: action?.nodeIdentity || nodeIdentity || null,
          upstreamNodeResults,
          order: idx,
        };
      }),
    );
    // Promise.all rejects when the first node finishes aborting, which leaves
    // slower parallel node sessions running after the workflow has stopped.
    // All node runners must reach their terminal lifecycle before propagating
    // either the stop or a regular node failure to the planner.
    const rejectedWaveResult = settledWaveResults.find((item) => item.status === "rejected");
    if (rejectedWaveResult) throw rejectedWaveResult.reason;
    const waveResults = settledWaveResults.map((item) => item.value);
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
