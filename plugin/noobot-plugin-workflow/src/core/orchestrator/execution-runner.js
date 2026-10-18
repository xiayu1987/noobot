/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";
import { WORKFLOW_ACTION, WORKFLOW_PLUGIN_DEFAULTS } from "../constants.js";
import {
  advanceWorkflowInstance,
  createWorkflowInstance,
  releaseWorkflowInstance,
  resolveWorkflowUpstreamActionSteps,
} from "../../workflow/adapter.js";
import { isWorkflowAbortError, throwIfWorkflowAborted } from "../hooks/runtime.js";
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
import { WORKFLOW_NODE_STATUS } from "./node-state-repository.js";
import {
  commitAndPublishWorkflowNodeState,
  resolveCommittedChildTerminal,
  CHILD_TERMINAL_RECEIPT_INVALID_CODE,
  settleUnstartedWorkflowNodes,
} from "./node-state-commit.js";
import { text } from "@noobot/shared/value";

function resolvePlanningNodeIdentity({ planningNodeSessions = [], pendingStep = {} } = {}) {
  const nodeId = text(pendingStep?.nodeId);
  if (!nodeId || !Array.isArray(planningNodeSessions) || !planningNodeSessions.length) return null;
  const matches = planningNodeSessions.filter((item = {}) => text(item?.nodeId) === nodeId);
  if (matches.length !== 1) {
    throw new Error(
      matches.length > 1
        ? `duplicate workflow node identity for ${nodeId}`
        : `missing workflow node identity for ${nodeId}`,
    );
  }
  const identity = matches[0] || {};
  const requiredFields = [
    "workflowRunId",
    "nodeExecutionId",
    "nodeId",
    "nodeName",
    "commandId",
    "dialogProcessId",
    "turnScopeId",
  ];
  const missingFields = requiredFields.filter((field) => !text(identity?.[field]));
  if (missingFields.length) {
    throw new Error(`incomplete workflow node identity for ${nodeId}: ${missingFields.join(",")}`);
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

function resolveStepItemRefs(item = {}) {
  const step = item?.step || {};
  const subSession = item?.subSession || {};
  const nodeIdentity = item?.nodeIdentity || {};
  return {
    step,
    subSession,
    workflowRunId: text(nodeIdentity.workflowRunId),
    nodeExecutionId: text(nodeIdentity.nodeExecutionId),
    commandId: text(nodeIdentity.commandId),
    turnScopeId: text(nodeIdentity.turnScopeId),
    nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(item),
    agentDialogProcessId: text(subSession.dialogProcessId),
    nodeSessionId: text(subSession.sessionId),
    actionNodeStateId: text(step.actionNodeStateId),
    stepId: text(step.stepId),
    stepIndex: Number.isFinite(Number(step.stepIndex)) ? Number(step.stepIndex) : -1,
    transferEnvelopes: getWorkflowTransferPayloadFromResult(subSession.result || {})
      .transferEnvelopes,
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
} = {}) {
  const refs = resolveStepItemRefs(item);
  return {
    transition: transitions,
    step: item?.step || null,
    action: item.effectiveAction,
    workflowRunId: refs.workflowRunId,
    nodeExecutionId: refs.nodeExecutionId,
    commandId: refs.commandId,
    turnScopeId: refs.turnScopeId,
    nodeDialogProcessId: refs.nodeDialogProcessId,
    agentDialogProcessId: refs.agentDialogProcessId,
    nodeSessionId: refs.nodeSessionId,
    actionNodeStateId: refs.actionNodeStateId,
    stepId: refs.stepId,
    stepIndex: refs.stepIndex,
    nodeResultText: truncateWorkflowResultText(
      stripHarnessReviewAppendix(resolveSubSessionFinalOutput(refs.subSession)),
      4000,
    ),
    nodeResultTransferEnvelopes: refs.transferEnvelopes,
    upstreamNodeResults: Array.isArray(item?.upstreamNodeResults) ? item.upstreamNodeResults : [],
    ...resolveWaveFields({ item, snapshot, transitions, parallelEnabled, waveSize }),
  };
}

function rememberCompletedStepResult({
  completedStepResults,
  item = {},
  semantic = {},
  transitions = 0,
} = {}) {
  const refs = resolveStepItemRefs(item);
  if (!refs.stepId) return;
  const semanticNode = resolveSemanticNodeForPendingStep({ semantic, pendingStep: refs.step });
  const nodeId = text(refs.step.nodeId);
  completedStepResults.set(refs.stepId, {
    transition: transitions,
    nodeId,
    nodeName: text(refs.step.nodeName),
    nodeTask: text(semanticNode?.task),
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
    transferEnvelopes: refs.transferEnvelopes,
  });
}

function resolveWaveNodeIdentity({ planningNodeSessions = [], step = {} } = {}) {
  const planningNodeIdentity = resolvePlanningNodeIdentity({
    planningNodeSessions,
    pendingStep: step,
  });
  const nodeIdentity = planningNodeIdentity
    ? { ...planningNodeIdentity, sessionId: randomUUID() }
    : null;
  return { nodeIdentity, activeChildExecutionId: nodeIdentity?.activeChildExecutionId || "" };
}

function findNodeStateByExecutionId(snapshot = null, nodeExecutionId = "") {
  const target = text(nodeExecutionId);
  return snapshot?.nodes?.find?.((node) => text(node?.nodeExecutionId) === target) || null;
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
    const { failure } = childTerminal.lifecycle;
    const error = new Error(failure.message);
    error.code = failure.code;
    error.failure = failure;
    error.nodeTerminalCommitted = true;
    return error;
  }
  if (childTerminal.nodeStatus === WORKFLOW_NODE_STATUS.STOPPED) {
    const error = new Error(`child execution reached ${childTerminal.lifecycle.state}`);
    error.name = "AbortError";
    error.code = "WORKFLOW_CHILD_TERMINAL_FAILURE";
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
  activeChildExecutionId,
} = {}) {
  const childTerminal = resolveCommittedChildTerminal(action?.subSession, activeChildExecutionId);
  await commitWaveNodeState({
    nodeState,
    nodeIdentity,
    ctx,
    status: childTerminal.nodeStatus,
    expectedRevision: runningFact?.node?.revision ?? null,
    nodeSessionId: action?.subSession?.sessionId || "",
    agentDialogProcessId: action?.subSession?.dialogProcessId || "",
    activeChildExecutionId,
    failure:
      childTerminal.nodeStatus === WORKFLOW_NODE_STATUS.FAILED
        ? {
            source: "child_execution",
            code: text(childTerminal.lifecycle.failure?.code),
            message: text(childTerminal.lifecycle.failure?.message),
          }
        : null,
  });
  const terminalError = buildChildTerminalError(childTerminal);
  if (terminalError) throw terminalError;
}

function shouldCommitWaveNodeFailure({ error, nodeState, nodeIdentity, runningFact } = {}) {
  if (!nodeState.repository || !nodeIdentity || !runningFact?.node) return false;
  return error?.nodeTerminalCommitted !== true;
}

function toWaveNodeFailure(error) {
  if (error?.code === CHILD_TERMINAL_RECEIPT_INVALID_CODE) {
    return { source: "workflow", code: error.code, message: text(error.message) };
  }
  return {
    source: "workflow_node_agent",
    code: text(error?.code) || "WORKFLOW_NODE_EXECUTION_FAILED",
    message: text(error?.message) || text(error),
  };
}

async function commitWaveNodeFailure({
  error,
  nodeState,
  nodeIdentity,
  ctx,
  signal,
  action,
  runningFact,
  activeChildExecutionId,
} = {}) {
  if (!shouldCommitWaveNodeFailure({ error, nodeState, nodeIdentity, runningFact })) return;
  const stopped = isWorkflowAbortError(error, signal);
  await commitWaveNodeState({
    nodeState,
    nodeIdentity,
    ctx,
    status: stopped ? WORKFLOW_NODE_STATUS.STOPPED : WORKFLOW_NODE_STATUS.FAILED,
    expectedRevision: runningFact.node.revision,
    nodeSessionId: action?.subSession?.sessionId || "",
    agentDialogProcessId: action?.subSession?.dialogProcessId || "",
    activeChildExecutionId,
    failure: toWaveNodeFailure(error),
  });
}

async function runWaveStep({
  step,
  idx,
  hookManager,
  options,
  ctx,
  signal,
  semantic,
  instanceId,
  planningNodeSessions,
  completedStepResults,
  nodeState,
  transitions,
} = {}) {
  throwIfWorkflowAborted(signal);
  const upstreamActionSteps = resolveWorkflowUpstreamActionSteps({
    instanceId,
    pendingStep: step,
  });
  const upstreamNodeResults = buildWorkflowUpstreamAttachmentResults({
    upstreamActionSteps,
    completedStepResults,
  });
  const { nodeIdentity, activeChildExecutionId } = resolveWaveNodeIdentity({
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
      activeChildExecutionId,
    });
  }
  let action = null;
  try {
    action = await runNodeAgent({
      hookManager,
      options,
      ctx,
      signal,
      instanceId,
      pendingStep: step,
      semantic,
      nodeIdentity,
      transition: transitions + idx + 1,
      upstreamNodeResults,
    });
    throwIfWorkflowAborted(signal);
    if (trackState) {
      await commitWaveChildTerminal({
        nodeState,
        nodeIdentity,
        ctx,
        action,
        runningFact,
        activeChildExecutionId,
      });
    }
  } catch (error) {
    await commitWaveNodeFailure({
      error,
      nodeState,
      nodeIdentity,
      ctx,
      signal,
      action,
      runningFact,
      activeChildExecutionId,
    });
    throw error;
  }
  return {
    step,
    action: action?.action || null,
    subSession: action?.subSession || null,
    nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(action),
    nodeIdentity: action.nodeIdentity,
    upstreamNodeResults,
    order: idx,
  };
}

export async function runWorkflowExecution({
  hookManager,
  options = {},
  ctx = {},
  signal,
  semantic = {},
  workflowRunId = "",
  planningNodeSessions = [],
} = {}) {
  const instanceId = text(workflowRunId);
  if (!instanceId) throw new Error("workflowRunId is required");
  if (!Array.isArray(planningNodeSessions) || !planningNodeSessions.length) {
    throw new Error("workflow planning node identities are required");
  }
  let snapshot = createWorkflowInstance({
    instanceId,
    semantic,
    options,
    meta: {
      userId: text(ctx?.userId),
      sessionId: text(ctx?.sessionId),
      dialogProcessId: text(ctx?.dialogProcessId),
    },
  });
  const { maxTransitions, maxParallelNodeAgents, parallelEnabled } =
    resolveWorkflowExecutionLimits(options);
  const nodeAgentRuns = [];
  const completedStepResults = new Map();
  const nodeStateRepository = options.workflowNodeStateRepository;
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
      throwIfWorkflowAborted(signal);
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
            signal,
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
      throwIfWorkflowAborted(signal);
      const actionQueue = waveResults
        .slice()
        .sort((a, b) => Number(b?.step?.index || 0) - Number(a?.step?.index || 0));
      for (const item of actionQueue) {
        throwIfWorkflowAborted(signal);
        if (!snapshot || snapshot.completed === true || transitions >= maxTransitions) break;
        const resolvedStepIndex = resolveStepIndexForAction({
          snapshot,
          preferredIndex: item?.action?.stepIndex ?? item?.step?.index ?? 0,
          pendingStep: item?.step || {},
        });
        const effectiveAction = {
          type: (text(item?.action?.type) || WORKFLOW_ACTION.SUBMIT).toLowerCase(),
          stepIndex: resolvedStepIndex,
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
          }),
        );
        rememberCompletedStepResult({
          completedStepResults,
          item: recordItem,
          semantic,
          transitions,
        });
      }
    }
    throwIfWorkflowAborted(signal);
    const execution = {
      started: true,
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
      const stopped = isWorkflowAbortError(error, signal);
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
