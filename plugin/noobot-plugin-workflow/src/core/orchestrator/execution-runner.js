/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";
import {
  advanceWorkflowInstance,
  createWorkflowInstance,
  releaseWorkflowInstance,
  resolveWorkflowUpstreamActionSteps,
} from "../../workflow/adapter.js";
import { isWorkflowAbortError, throwIfWorkflowAborted } from "../hooks/runtime.js";
import { getWorkflowTransferPayloadFromResult } from "../hooks/attachments.js";
import { resolveSemanticNodeForPendingStep, runNodeAgent } from "../hooks/node-agent.js";
import { buildWorkflowUpstreamAttachmentResults } from "../hooks/node-upstream-messages.js";
import {
  resolveSubSessionFinalOutput,
  stripHarnessReviewAppendix,
  truncateWorkflowResultText,
} from "../hooks/persistence.js";
import { WORKFLOW_NODE_STATUS } from "./node-state-repository.js";
import {
  commitAndPublishWorkflowNodeState,
  resolveCommittedChildTerminal,
  CHILD_TERMINAL_RECEIPT_INVALID_CODE,
  settleUnstartedWorkflowNodes,
} from "./node-state-commit.js";
import { isCanonicalText, text } from "@noobot/shared/value";

function resolvePlanningNodeIdentity({ planningNodeSessions, pendingStep }) {
  const { nodeId } = pendingStep;
  const matches = planningNodeSessions.filter((item) => item.nodeId === nodeId);
  if (matches.length !== 1) {
    throw new Error(
      matches.length > 1
        ? `duplicate workflow node identity for ${nodeId}`
        : `missing workflow node identity for ${nodeId}`,
    );
  }
  return matches[0];
}

function resolveStepItemRefs(item) {
  const { step, subSession, nodeIdentity } = item;
  return {
    step,
    subSession,
    workflowRunId: nodeIdentity.workflowRunId,
    nodeExecutionId: nodeIdentity.nodeExecutionId,
    commandId: nodeIdentity.commandId,
    turnScopeId: nodeIdentity.turnScopeId,
    nodeSessionId: nodeIdentity.sessionId,
    actionNodeStateId: step.actionNodeStateId,
    stepId: step.stepId,
    stepIndex: step.stepIndex,
    transferEnvelopes: getWorkflowTransferPayloadFromResult(subSession.result).transferEnvelopes,
  };
}

function resolveWaveFields({ item, snapshot, transitions, parallelEnabled, waveSize }) {
  return {
    parallelWave: parallelEnabled ? Math.floor((transitions - 1) / Math.max(1, waveSize)) + 1 : 0,
    waveOrder: item.order,
    pendingStepCount: snapshot.pendingStepCount,
  };
}

function buildNodeAgentRunRecord({ item, snapshot, transitions, parallelEnabled, waveSize }) {
  const refs = resolveStepItemRefs(item);
  return {
    transition: transitions,
    step: item.step,
    workflowRunId: refs.workflowRunId,
    nodeExecutionId: refs.nodeExecutionId,
    commandId: refs.commandId,
    turnScopeId: refs.turnScopeId,
    nodeSessionId: refs.nodeSessionId,
    actionNodeStateId: refs.actionNodeStateId,
    stepId: refs.stepId,
    stepIndex: refs.stepIndex,
    nodeResultText: truncateWorkflowResultText(
      stripHarnessReviewAppendix(resolveSubSessionFinalOutput(refs.subSession)),
      4000,
    ),
    nodeResultTransferEnvelopes: refs.transferEnvelopes,
    upstreamNodeResults: item.upstreamNodeResults,
    ...resolveWaveFields({ item, snapshot, transitions, parallelEnabled, waveSize }),
  };
}

function rememberCompletedStepResult({ completedStepResults, item, semantic, transitions }) {
  const refs = resolveStepItemRefs(item);
  const semanticNode = resolveSemanticNodeForPendingStep({ semantic, pendingStep: refs.step });
  completedStepResults.set(refs.stepId, {
    transition: transitions,
    nodeTask: semanticNode.task,
    nodeSessionId: refs.nodeSessionId,
    transferEnvelopes: refs.transferEnvelopes,
  });
}

function resolveWaveNodeIdentity({ planningNodeSessions, step }) {
  const planningNodeIdentity = resolvePlanningNodeIdentity({
    planningNodeSessions,
    pendingStep: step,
  });
  return { ...planningNodeIdentity, sessionId: randomUUID() };
}

function findNodeStateByExecutionId(snapshot, nodeExecutionId) {
  const matches = snapshot.nodes.filter((node) => node.nodeExecutionId === nodeExecutionId);
  if (matches.length !== 1) throw new Error(`workflow node state not found: ${nodeExecutionId}`);
  return matches[0];
}

async function commitWaveNodeState({ nodeState, nodeIdentity, ctx, ...fields }) {
  const fact = await commitAndPublishWorkflowNodeState({
    repository: nodeState.repository,
    ctx,
    transition: {
      workflowRunId: nodeIdentity.workflowRunId,
      nodeExecutionId: nodeIdentity.nodeExecutionId,
      ...fields,
    },
  });
  nodeState.snapshot = fact.snapshot;
  return fact;
}

function buildChildTerminalError(childTerminal = {}) {
  if (childTerminal.nodeStatus === WORKFLOW_NODE_STATUS.FAILED) {
    const { failure } = childTerminal.lifecycle;
    const error = new Error(failure.message);
    error.code = failure.code;
    error.failure = failure;
    return error;
  }
  if (childTerminal.nodeStatus === WORKFLOW_NODE_STATUS.STOPPED) {
    const error = new Error(`child execution reached ${childTerminal.lifecycle.state}`);
    error.name = "AbortError";
    error.code = "WORKFLOW_CHILD_TERMINAL_FAILURE";
    return error;
  }
  return null;
}

function toChildTerminalFailure({ nodeStatus, lifecycle }) {
  if (nodeStatus === WORKFLOW_NODE_STATUS.FAILED) {
    return {
      source: "child_execution",
      code: lifecycle.failure.code,
      message: lifecycle.failure.message,
    };
  }
  if (nodeStatus === WORKFLOW_NODE_STATUS.STOPPED) {
    return {
      source: "child_execution",
      code: "WORKFLOW_CHILD_STOPPED",
      message: `child execution reached ${lifecycle.state}`,
    };
  }
  return undefined;
}

async function commitWaveChildTerminal({
  nodeState,
  nodeIdentity,
  ctx,
  childTerminal,
  runningFact,
}) {
  await commitWaveNodeState({
    nodeState,
    nodeIdentity,
    ctx,
    status: childTerminal.nodeStatus,
    expectedRevision: runningFact.node.revision,
    failure: toChildTerminalFailure(childTerminal),
  });
  const terminalError = buildChildTerminalError(childTerminal);
  if (terminalError) throw terminalError;
}

const UNCODED_NODE_FAILURE_CODE = "WORKFLOW_NODE_EXECUTION_FAILED";

function toWaveNodeFailure(error) {
  return {
    source: error.code === CHILD_TERMINAL_RECEIPT_INVALID_CODE ? "workflow" : "workflow_node_agent",
    code: isCanonicalText(error.code) ? error.code : UNCODED_NODE_FAILURE_CODE,
    message: error.message,
  };
}

async function commitWaveNodeFailure({ error, nodeState, nodeIdentity, ctx, signal, runningFact }) {
  const stopped = isWorkflowAbortError(error, signal);
  await commitWaveNodeState({
    nodeState,
    nodeIdentity,
    ctx,
    status: stopped ? WORKFLOW_NODE_STATUS.STOPPED : WORKFLOW_NODE_STATUS.FAILED,
    expectedRevision: runningFact.node.revision,
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
    stepId: step.stepId,
  });
  const upstreamNodeResults = buildWorkflowUpstreamAttachmentResults({
    upstreamActionSteps,
    completedStepResults,
  });
  const nodeIdentity = resolveWaveNodeIdentity({ planningNodeSessions, step });
  const runningFact = await commitWaveNodeState({
    nodeState,
    nodeIdentity,
    ctx,
    status: WORKFLOW_NODE_STATUS.RUNNING,
    expectedRevision: findNodeStateByExecutionId(nodeState.snapshot, nodeIdentity.nodeExecutionId)
      .revision,
    nodeSessionId: nodeIdentity.sessionId,
  });
  let action;
  let childTerminal;
  try {
    action = await runNodeAgent({
      hookManager,
      options,
      ctx,
      signal,
      pendingStep: step,
      semantic,
      nodeIdentity,
      transition: transitions + idx + 1,
      upstreamNodeResults,
    });
    throwIfWorkflowAborted(signal);
    childTerminal = resolveCommittedChildTerminal(
      action.subSession,
      nodeIdentity.activeChildExecutionId,
    );
  } catch (error) {
    await commitWaveNodeFailure({ error, nodeState, nodeIdentity, ctx, signal, runningFact });
    throw error;
  }
  await commitWaveChildTerminal({ nodeState, nodeIdentity, ctx, childTerminal, runningFact });
  return {
    step,
    action: action.action,
    subSession: action.subSession,
    nodeIdentity,
    upstreamNodeResults,
    order: idx,
  };
}

export async function runWorkflowExecution({
  hookManager,
  options,
  ctx,
  signal,
  semantic,
  workflowRunId,
  nodeStateSnapshot,
}) {
  const instanceId = text(workflowRunId);
  if (!instanceId) throw new Error("workflowRunId is required");
  if (nodeStateSnapshot?.workflowRunId !== instanceId) {
    throw new Error("workflow node state snapshot must belong to workflowRunId");
  }
  const planningNodeSessions = nodeStateSnapshot.nodes;
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
  const {
    maxAutoTransitions: maxTransitions,
    maxParallelNodeAgents,
    parallelNodeExecution: parallelEnabled,
  } = options;
  const nodeAgentRuns = [];
  const completedStepResults = new Map();
  const nodeState = {
    repository: options.workflowNodeStateRepository,
    snapshot: nodeStateSnapshot,
  };
  let transitions = 0;

  try {
    while (!snapshot.completed && transitions < maxTransitions) {
      throwIfWorkflowAborted(signal);
      const pending = snapshot.pendingSteps;
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
      const actionQueue = waveResults.slice().sort((a, b) => b.step.index - a.step.index);
      for (const item of actionQueue) {
        throwIfWorkflowAborted(signal);
        if (snapshot.completed || transitions >= maxTransitions) break;
        snapshot = advanceWorkflowInstance({
          instanceId,
          action: { type: item.action.type, stepId: item.step.stepId },
        });
        transitions += 1;
        nodeAgentRuns.push(
          buildNodeAgentRunRecord({
            item,
            snapshot,
            transitions,
            parallelEnabled,
            waveSize,
          }),
        );
        rememberCompletedStepResult({
          completedStepResults,
          item,
          semantic,
          transitions,
        });
      }
    }
    throwIfWorkflowAborted(signal);
    const execution = {
      started: true,
      autoTransitions: transitions,
      completed: snapshot.completed,
      pendingStepCount: snapshot.pendingStepCount,
      actionRecords: snapshot.actionRecords,
      nodeAgentRuns,
    };
    return {
      execution,
      nodeAgentRuns,
      nodeStateSnapshot: nodeState.snapshot,
    };
  } catch (error) {
    nodeState.snapshot = await settleUnstartedWorkflowNodes({
      repository: nodeState.repository,
      workflowRunId: instanceId,
      ctx,
      status: isWorkflowAbortError(error, signal)
        ? WORKFLOW_NODE_STATUS.STOPPED
        : WORKFLOW_NODE_STATUS.SKIPPED,
    });
    throw error;
  } finally {
    releaseWorkflowInstance({ instanceId });
  }
}
