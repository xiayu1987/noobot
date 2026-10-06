/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";
import { deriveAgentExecutionId } from "@noobot/session-protocol";
import { WORKFLOW_ACTION, WORKFLOW_PLUGIN_DEFAULTS } from "../constants.js";
import {
  advanceWorkflowInstance,
  createWorkflowInstance,
  releaseWorkflowInstance,
  resolveWorkflowUpstreamActionSteps,
} from "../../workflow/adapter.js";
import { isWorkflowAbortError, normalizeString, throwIfWorkflowAborted } from "../hooks/runtime.js";
import { getWorkflowTransferPayloadFromResult } from "../hooks/attachments.js";
import {
  resolveSemanticNodeForPendingStep,
  resolveStepIndexForAction,
  runNodeAgent,
} from "../hooks/node-agent.js";
import { buildWorkflowUpstreamAttachmentResults } from "../hooks/node-upstream-messages.js";
import {
  resolveSubSessionFinalOutput,
  stripHarnessReviewAppendix,
  truncateWorkflowResultText,
} from "../hooks/persistence.js";
import { resolveWorkflowNodeDialogProcessId } from "../node-dialog-process-id.js";
import {
  resolveWorkflowNodeStateRepository,
  WORKFLOW_NODE_STATUS,
} from "./node-state-repository.js";
import {
  commitAndPublishWorkflowNodeState,
  resolveCommittedChildTerminal,
  settleUnstartedWorkflowNodes,
} from "./node-state-commit.js";

function resolvePlanningNodeIdentity({ planningNodeSessions = [], pendingStep = {} } = {}) {
  const nodeId = String(pendingStep?.nodeId || pendingStep?.id || "").trim();
  if (!nodeId || !Array.isArray(planningNodeSessions) || !planningNodeSessions.length) return null;
  const attempt = Math.max(
    1,
    Math.floor(Number(pendingStep?.attempt || pendingStep?.attemptIndex || 1) || 1),
  );
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
  const requiredFields = [
    "workflowRunId",
    "nodeExecutionId",
    "commandId",
    "dialogProcessId",
    "turnScopeId",
  ];
  const missingFields = requiredFields.filter((field) => !String(identity?.[field] || "").trim());
  if (missingFields.length) {
    throw new Error(
      `incomplete workflow node identity for ${nodeId} attempt ${attempt}: ${missingFields.join(",")}`,
    );
  }
  return identity;
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

function resolveStepItemRefs(item = {}) {
  const step = item?.step || {};
  const subSession = item?.subSession || {};
  const nodeIdentity = item?.nodeIdentity || {};
  return {
    step,
    subSession,
    workflowRunId: normalizeString(nodeIdentity.workflowRunId),
    nodeExecutionId: normalizeString(nodeIdentity.nodeExecutionId),
    commandId: normalizeString(nodeIdentity.commandId),
    turnScopeId: normalizeString(nodeIdentity.turnScopeId),
    nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(item),
    agentDialogProcessId: normalizeString(subSession.dialogProcessId),
    nodeSessionId: normalizeString(subSession.sessionId),
    actionNodeStateId: normalizeString(step.actionNodeStateId),
    stepId: normalizeString(step.stepId),
    stepIndex: Number.isFinite(Number(step.stepIndex)) ? Number(step.stepIndex) : -1,
    transferEnvelopes: getWorkflowTransferPayloadFromResult(subSession.result || {})
      .transferEnvelopes,
    stepFailure: resolveItemStepFailure(item),
  };
}

function resolveWaveFields({ item, snapshot, transitions, parallelEnabled, waveSize }) {
  return {
    parallelWave: parallelEnabled ? Math.floor((transitions - 1) / Math.max(1, waveSize)) + 1 : 0,
    waveOrder: Number(item?.order ?? 0),
    pendingStepCount: Number(snapshot?.pendingStepCount || 0),
  };
}

function buildNodeAgentRunRecord({
  item = {},
  snapshot = {},
  transitions = 0,
  parallelEnabled = false,
  waveSize = 1,
  ctx = {},
} = {}) {
  const refs = resolveStepItemRefs(item);
  return {
    transition: transitions,
    step: item?.step || null,
    action: item?.effectiveAction || item?.action || null,
    workflowRunId: refs.workflowRunId,
    nodeExecutionId: refs.nodeExecutionId,
    commandId: refs.commandId,
    turnScopeId: refs.turnScopeId,
    nodeDialogProcessId: refs.nodeDialogProcessId,
    agentDialogProcessId: refs.agentDialogProcessId,
    nodeSessionId: refs.nodeSessionId,
    nodeSessionPersistedPath: normalizeString(refs.subSession.persisted?.outputDir),
    actionNodeStateId: refs.actionNodeStateId,
    stepId: refs.stepId,
    stepIndex: refs.stepIndex,
    nodeResultText: truncateWorkflowResultText(
      stripHarnessReviewAppendix(resolveSubSessionFinalOutput(refs.subSession)),
      4000,
    ),
    nodeResultTransferEnvelopes: refs.transferEnvelopes,
    stepFailure: refs.stepFailure,
    upstreamNodeResults: Array.isArray(item?.upstreamNodeResults) ? item.upstreamNodeResults : [],
    ...resolveWaveFields({ item, snapshot, transitions, parallelEnabled, waveSize }),
  };
}

function resolveCompletedNodeTask(step = {}, semanticNode = null) {
  const node = semanticNode || {};
  return normalizeString(
    step.nodeTask || node.task || node.taskText || node.instruction || node.mission,
  );
}

function rememberCompletedStepResult({
  completedStepResults,
  item = {},
  semantic = {},
  transitions = 0,
  ctx = {},
} = {}) {
  const refs = resolveStepItemRefs(item);
  if (!refs.stepId) return;
  const semanticNode = resolveSemanticNodeForPendingStep({ semantic, pendingStep: refs.step });
  const nodeId = normalizeString(refs.step.nodeId || semanticNode?.id);
  completedStepResults.set(refs.stepId, {
    transition: transitions,
    nodeId,
    nodeName: normalizeString(refs.step.nodeName || semanticNode?.name || nodeId),
    nodeTask: resolveCompletedNodeTask(refs.step, semanticNode),
    actionNodeStateId: refs.actionNodeStateId,
    stepId: refs.stepId,
    stepIndex: refs.stepIndex,
    nodeDialogProcessId: refs.nodeDialogProcessId,
    agentDialogProcessId: refs.agentDialogProcessId,
    workflowRunId: refs.workflowRunId,
    nodeExecutionId: refs.nodeExecutionId,
    commandId: refs.commandId,
    turnScopeId: refs.turnScopeId,
    nodeSessionId: refs.nodeSessionId,
    stepFailure: refs.stepFailure,
    transferEnvelopes: refs.transferEnvelopes,
  });
}

function resolveWaveNodeIdentity({ planningNodeSessions = [], step = {} } = {}) {
  const planningNodeIdentity = resolvePlanningNodeIdentity({
    planningNodeSessions,
    pendingStep: step,
  });
  const nodeIdentity = planningNodeIdentity
    ? {
        ...planningNodeIdentity,
        sessionId: String(planningNodeIdentity?.sessionId || "").trim() || randomUUID(),
      }
    : null;
  const childExecutionId = deriveAgentExecutionId({
    executionId: nodeIdentity?.childExecutionId,
    turnScopeId: nodeIdentity?.turnScopeId,
  });
  return { nodeIdentity, childExecutionId };
}

function findNodeStateByExecutionId(snapshot = null, nodeExecutionId = "") {
  const target = String(nodeExecutionId || "").trim();
  return (
    snapshot?.nodes?.find?.((node) => String(node?.nodeExecutionId || "").trim() === target) || null
  );
}

async function commitWaveNodeState({ nodeState, nodeIdentity, ctx, ...fields } = {}) {
  const fact = await commitAndPublishWorkflowNodeState({
    repository: nodeState.repository,
    ctx,
    workflowRunId: nodeIdentity.workflowRunId,
    nodeExecutionId: nodeIdentity.nodeExecutionId,
    ...fields,
  });
  nodeState.snapshot = fact?.snapshot || nodeState.snapshot;
  return fact;
}

function buildChildTerminalError(childTerminal = {}) {
  if (childTerminal.nodeStatus === WORKFLOW_NODE_STATUS.FAILED) {
    const failure = childTerminal.lifecycle.failure || { message: "child execution failed" };
    const error = new Error(failure.message || "child execution failed");
    error.code = failure.code || "WORKFLOW_CHILD_EXECUTION_FAILED";
    error.failure = failure;
    error.nodeTerminalCommitted = true;
    return error;
  }
  if (childTerminal.nodeStatus === WORKFLOW_NODE_STATUS.STOPPED) {
    const error = new Error(
      childTerminal.lifecycle?.failure?.message ||
        `child execution reached ${childTerminal.lifecycle.state}`,
    );
    error.name = "AbortError";
    error.code = childTerminal.lifecycle?.failure?.code || "WORKFLOW_CHILD_TERMINAL_FAILURE";
    error.nodeTerminalCommitted = true;
    return error;
  }
  return null;
}

async function commitWaveChildTerminal({
  nodeState,
  nodeIdentity,
  ctx,
  action,
  runningFact,
  childExecutionId,
} = {}) {
  const childTerminal = resolveCommittedChildTerminal(action?.subSession, childExecutionId);
  await commitWaveNodeState({
    nodeState,
    nodeIdentity,
    ctx,
    status: childTerminal.nodeStatus,
    expectedRevision: runningFact?.node?.revision ?? null,
    nodeSessionId: action?.subSession?.sessionId || "",
    agentDialogProcessId: action?.subSession?.dialogProcessId || "",
    childExecutionId,
    failure:
      childTerminal.nodeStatus === WORKFLOW_NODE_STATUS.FAILED
        ? childTerminal.lifecycle.failure || { message: "child execution failed" }
        : null,
  });
  const terminalError = buildChildTerminalError(childTerminal);
  if (terminalError) throw terminalError;
}

function shouldCommitWaveNodeFailure({ error, nodeState, nodeIdentity, runningFact } = {}) {
  if (!nodeState.repository || !nodeIdentity || !runningFact?.node) return false;
  return error?.nodeTerminalCommitted !== true && error?.nodeTerminalReceiptRejected !== true;
}

function toWaveNodeFailure(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || "",
    message: error?.message || String(error || "workflow node failed"),
  };
}

async function commitWaveNodeFailure({
  error,
  nodeState,
  nodeIdentity,
  ctx,
  action,
  runningFact,
  childExecutionId,
} = {}) {
  if (!shouldCommitWaveNodeFailure({ error, nodeState, nodeIdentity, runningFact })) return;
  const stopped = isWorkflowAbortError(error, ctx);
  await commitWaveNodeState({
    nodeState,
    nodeIdentity,
    ctx,
    status: stopped ? WORKFLOW_NODE_STATUS.STOPPED : WORKFLOW_NODE_STATUS.FAILED,
    expectedRevision: runningFact.node.revision,
    nodeSessionId: action?.subSession?.sessionId || "",
    agentDialogProcessId: action?.subSession?.dialogProcessId || "",
    childExecutionId,
    failure: toWaveNodeFailure(error),
  });
}

async function runWaveStep({
  step,
  idx,
  hookManager,
  options,
  ctx,
  semantic,
  instanceId,
  planningNodeSessions,
  completedStepResults,
  nodeState,
  transitions,
} = {}) {
  throwIfWorkflowAborted(ctx);
  const upstreamActionSteps = resolveWorkflowUpstreamActionSteps({
    instanceId,
    pendingStep: step,
  });
  const upstreamNodeResults = buildWorkflowUpstreamAttachmentResults({
    upstreamActionSteps,
    completedStepResults,
  });
  const { nodeIdentity, childExecutionId } = resolveWaveNodeIdentity({
    planningNodeSessions,
    step,
  });
  const trackState = Boolean(nodeState.repository && nodeIdentity);
  let runningFact = null;
  if (trackState) {
    const currentNodeState = findNodeStateByExecutionId(
      nodeState.snapshot,
      nodeIdentity?.nodeExecutionId,
    );
    runningFact = await commitWaveNodeState({
      nodeState,
      nodeIdentity,
      ctx,
      status: WORKFLOW_NODE_STATUS.RUNNING,
      expectedRevision: currentNodeState?.revision ?? null,
      nodeSessionId: nodeIdentity.sessionId,
      childExecutionId,
    });
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
    if (trackState) {
      await commitWaveChildTerminal({
        nodeState,
        nodeIdentity,
        ctx,
        action,
        runningFact,
        childExecutionId,
      });
    }
  } catch (error) {
    await commitWaveNodeFailure({
      error,
      nodeState,
      nodeIdentity,
      ctx,
      action,
      runningFact,
      childExecutionId,
    });
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
}

export async function runWorkflowExecution({
  hookManager,
  options = {},
  ctx = {},
  semantic = {},
  workflowRunId = "",
  planningNodeSessions = [],
} = {}) {
  const instanceId = String(workflowRunId || "").trim();
  if (!instanceId) throw new Error("workflowRunId is required");
  if (!Array.isArray(planningNodeSessions) || !planningNodeSessions.length) {
    throw new Error("workflow planning node identities are required");
  }
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
  const nodeStateRepository = resolveWorkflowNodeStateRepository(options);
  const nodeState = {
    repository: nodeStateRepository,
    snapshot: await nodeStateRepository.initialize({
      workflowRunId: instanceId,
      planningNodeSessions,
    }),
  };
  let transitions = 0;

  try {
    while (snapshot && snapshot.completed !== true && transitions < maxTransitions) {
      throwIfWorkflowAborted(ctx);
      const pending = Array.isArray(snapshot.pendingSteps) ? snapshot.pendingSteps : [];
      if (!pending.length) break;
      const waveSize = parallelEnabled ? Math.min(maxParallelNodeAgents, pending.length) : 1;
      const waveSteps = pending.slice(0, waveSize);
      const settledWaveResults = await Promise.allSettled(
        waveSteps.map((step, idx) =>
          runWaveStep({
            step,
            idx,
            hookManager,
            options,
            ctx,
            semantic,
            instanceId,
            planningNodeSessions,
            completedStepResults,
            nodeState,
            transitions,
          }),
        ),
      );
      const rejectedWaveResult = settledWaveResults.find((item) => item.status === "rejected");
      if (rejectedWaveResult) throw rejectedWaveResult.reason;
      const waveResults = settledWaveResults.map((item) => item.value);
      throwIfWorkflowAborted(ctx);
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
          type: String(item?.action?.type || WORKFLOW_ACTION.SUBMIT)
            .trim()
            .toLowerCase(),
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
      nodeStateSnapshot: nodeState.snapshot,
      instanceId,
    };
  } catch (error) {
    if (nodeStateRepository && nodeState.snapshot) {
      const stopped = isWorkflowAbortError(error, ctx);
      nodeState.snapshot = await settleUnstartedWorkflowNodes({
        repository: nodeStateRepository,
        snapshot: nodeState.snapshot,
        ctx,
        status: stopped ? WORKFLOW_NODE_STATUS.STOPPED : WORKFLOW_NODE_STATUS.SKIPPED,
      });
    }
    throw error;
  }
}
