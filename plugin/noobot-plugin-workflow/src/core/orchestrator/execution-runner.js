/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";
import {
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol/workflow-runtime-event";
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
  buildWorkflowUpstreamAttachmentResults,
  resolveSemanticNodeForPendingStep,
  resolveStepIndexForAction,
  runNodeAgent,
} from "../hooks/node-agent.js";
import {
  commitWorkflowRuntimeEvent,
  resolveSubSessionFinalOutput,
  stripHarnessReviewAppendix,
  truncateWorkflowResultText,
} from "../hooks/persistence.js";
import { resolveWorkflowNodeDialogProcessId } from "../node-dialog-process-id.js";
import {
  resolveWorkflowNodeStateRepository,
  WORKFLOW_NODE_STATUS,
} from "./node-state-repository.js";

const CHILD_TERMINAL_NODE_STATUS = Object.freeze({
  completed: WORKFLOW_NODE_STATUS.SUCCEEDED,
  stop_completed: WORKFLOW_NODE_STATUS.STOPPED,
  action_failed: WORKFLOW_NODE_STATUS.FAILED,
  processing_failed: WORKFLOW_NODE_STATUS.FAILED,
  completion_failed: WORKFLOW_NODE_STATUS.FAILED,
  stop_failed: WORKFLOW_NODE_STATUS.FAILED,
});

export function resolveCommittedChildTerminal(subSession = {}, expectedExecutionId = "") {
  const lifecycle =
    subSession?.lifecycle && typeof subSession.lifecycle === "object" ? subSession.lifecycle : null;
  const fail = (reason) => {
    const error = new Error(`invalid child execution terminal receipt: ${reason}`);
    error.code = "WORKFLOW_CHILD_TERMINAL_RECEIPT_INVALID";
    error.receiptReason = reason;
    error.nodeTerminalReceiptRejected = true;
    throw error;
  };
  if (!lifecycle) return fail("missing_lifecycle");
  if (String(lifecycle.executionId || "").trim() !== String(expectedExecutionId || "").trim()) {
    return fail("execution_identity_mismatch");
  }
  if (
    String(lifecycle.executionKind || "agent")
      .trim()
      .toLowerCase() !== "agent"
  ) {
    return fail("execution_kind_mismatch");
  }
  if (!Number.isInteger(lifecycle.revision) || lifecycle.revision < 1) {
    return fail("invalid_revision");
  }
  if (!Number.isInteger(lifecycle.sequence) || lifecycle.sequence < 1) {
    return fail("invalid_sequence");
  }
  const state = String(lifecycle.state || "")
    .trim()
    .toLowerCase();
  const nodeStatus = CHILD_TERMINAL_NODE_STATUS[state];
  if (!nodeStatus) return fail("non_terminal_state");
  return { lifecycle, nodeStatus };
}

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

async function publishWorkflowNodeStateCommitted({ options = {}, ctx = {}, fact = null } = {}) {
  const node = fact?.node && typeof fact.node === "object" ? fact.node : null;
  if (!node) return null;
  const event = WORKFLOW_RUNTIME_EVENT.NODE_STATE;
  const data = {
    workflowRunId: node.workflowRunId,
    nodeExecutionId: node.nodeExecutionId,
    commandId: node.commandId,
    nodeSessionId: node.nodeSessionId,
    dialogProcessId: node.dialogProcessId,
    agentDialogProcessId: node.agentDialogProcessId,
    turnScopeId: node.turnScopeId,
    nodeId: node.nodeId,
    nodeName: node.nodeName,
    status: node.status,
    failure: node.failure,
    activeChildExecutionId: node.activeChildExecutionId,
    attemptExecutionIds: node.attemptExecutionIds,
    startedAt: node.startedAt,
    completedAt: node.completedAt,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    applied: fact.applied === true,
    deduplicated: fact.deduplicated === true,
  };
  return commitWorkflowRuntimeEvent({
    ctx,
    eventType: event,
    payload: data,
    orderingDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
    orderingScopeId: node.workflowRunId,
    revision: node.revision,
    executionId: node.nodeExecutionId,
  });
}

async function commitAndPublishWorkflowNodeState({
  repository,
  options = {},
  ctx = {},
  workflowRunId = "",
  nodeExecutionId = "",
  status = "",
  expectedRevision = null,
  nodeSessionId = "",
  agentDialogProcessId = "",
  childExecutionId = "",
  failure = null,
} = {}) {
  const fact = await repository.commit({
    workflowRunId,
    nodeExecutionId,
    status,
    expectedRevision,
    nodeSessionId,
    agentDialogProcessId,
    childExecutionId,
    failure,
  });
  if (fact?.applied === true) {
    await publishWorkflowNodeStateCommitted({ options, ctx, fact });
  }
  return fact;
}

async function settleUnstartedWorkflowNodes({
  repository,
  snapshot,
  options = {},
  ctx = {},
  status,
} = {}) {
  if (
    !repository ||
    !snapshot ||
    ![WORKFLOW_NODE_STATUS.STOPPED, WORKFLOW_NODE_STATUS.SKIPPED].includes(status)
  ) {
    return snapshot;
  }
  let latest =
    (await repository.getSnapshot({ workflowRunId: snapshot.workflowRunId })) || snapshot;
  for (const node of latest.nodes || []) {
    if (![WORKFLOW_NODE_STATUS.PENDING, WORKFLOW_NODE_STATUS.READY].includes(node?.status))
      continue;
    const fact = await commitAndPublishWorkflowNodeState({
      repository,
      options,
      ctx,
      workflowRunId: node.workflowRunId,
      nodeExecutionId: node.nodeExecutionId,
      status,
      expectedRevision: node.revision,
      failure:
        status === WORKFLOW_NODE_STATUS.STOPPED
          ? {
              name: "AbortError",
              code: "WORKFLOW_STOPPED",
              message: "workflow stopped before node execution",
            }
          : null,
    });
    latest = fact?.snapshot || latest;
  }
  return latest;
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

function buildNodeAgentRunRecord({
  item = {},
  snapshot = {},
  transitions = 0,
  parallelEnabled = false,
  waveSize = 1,
  ctx = {},
} = {}) {
  const resultTransferPayload = getWorkflowTransferPayloadFromResult(
    item?.subSession?.result || {},
  );
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
    agentDialogProcessId: String(item?.subSession?.dialogProcessId || "").trim(),
    nodeSessionId: String(item?.subSession?.sessionId || "").trim(),
    nodeSessionPersistedPath: String(item?.subSession?.persisted?.outputDir || "").trim(),
    actionNodeStateId: String(item?.step?.actionNodeStateId || "").trim(),
    stepId: String(item?.step?.stepId || "").trim(),
    stepIndex: Number.isFinite(Number(item?.step?.stepIndex)) ? Number(item.step.stepIndex) : -1,
    nodeResultText: truncateWorkflowResultText(
      stripHarnessReviewAppendix(resolveSubSessionFinalOutput(item?.subSession || {})),
      4000,
    ),
    nodeResultTransferEnvelopes: resultTransferPayload.transferEnvelopes,
    stepFailure,
    upstreamNodeResults: Array.isArray(item?.upstreamNodeResults) ? item.upstreamNodeResults : [],
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
  const completedNodeId = String(item?.step?.nodeId || completedSemanticNode?.id || "").trim();
  const completedNodeTask = String(
    item?.step?.nodeTask ||
      completedSemanticNode?.task ||
      completedSemanticNode?.taskText ||
      completedSemanticNode?.instruction ||
      completedSemanticNode?.mission ||
      "",
  ).trim();
  const resultTransferPayload = getWorkflowTransferPayloadFromResult(
    item?.subSession?.result || {},
  );
  const stepFailure = resolveItemStepFailure(item);
  completedStepResults.set(completedStepId, {
    transition: transitions,
    nodeId: completedNodeId,
    nodeName: String(item?.step?.nodeName || completedSemanticNode?.name || completedNodeId).trim(),
    nodeTask: completedNodeTask,
    actionNodeStateId: String(item?.step?.actionNodeStateId || "").trim(),
    stepId: completedStepId,
    stepIndex: Number.isFinite(Number(item?.step?.stepIndex)) ? Number(item.step.stepIndex) : -1,
    nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(item),
    agentDialogProcessId: String(item?.subSession?.dialogProcessId || "").trim(),
    workflowRunId: String(item?.nodeIdentity?.workflowRunId || "").trim(),
    nodeExecutionId: String(item?.nodeIdentity?.nodeExecutionId || "").trim(),
    commandId: String(item?.nodeIdentity?.commandId || "").trim(),
    turnScopeId: String(item?.nodeIdentity?.turnScopeId || "").trim(),
    nodeSessionId: String(item?.subSession?.sessionId || "").trim(),
    stepFailure,
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
  let nodeStateSnapshot = await nodeStateRepository.initialize({
    workflowRunId: instanceId,
    planningNodeSessions,
  });
  let transitions = 0;

  try {
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
          const childExecutionId = String(
            nodeIdentity?.childExecutionId || `agent:${nodeIdentity?.turnScopeId || ""}`,
          ).trim();
          const currentNodeState =
            nodeStateSnapshot?.nodes?.find?.(
              (node) =>
                String(node?.nodeExecutionId || "").trim() ===
                String(nodeIdentity?.nodeExecutionId || "").trim(),
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
              nodeSessionId: nodeIdentity.sessionId,
              childExecutionId,
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
              const childTerminal = resolveCommittedChildTerminal(
                action?.subSession,
                childExecutionId,
              );
              const terminalFact = await commitAndPublishWorkflowNodeState({
                repository: nodeStateRepository,
                options,
                ctx,
                workflowRunId: nodeIdentity.workflowRunId,
                nodeExecutionId: nodeIdentity.nodeExecutionId,
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
              nodeStateSnapshot = terminalFact?.snapshot || nodeStateSnapshot;
              if (childTerminal.nodeStatus === WORKFLOW_NODE_STATUS.FAILED) {
                const failure = childTerminal.lifecycle.failure || {
                  message: "child execution failed",
                };
                const error = new Error(failure.message || "child execution failed");
                error.code = failure.code || "WORKFLOW_CHILD_EXECUTION_FAILED";
                error.failure = failure;
                error.nodeTerminalCommitted = true;
                throw error;
              } else if (childTerminal.nodeStatus === WORKFLOW_NODE_STATUS.STOPPED) {
                const error = new Error(
                  childTerminal.lifecycle?.failure?.message ||
                    `child execution reached ${childTerminal.lifecycle.state}`,
                );
                error.name = "AbortError";
                error.code =
                  childTerminal.lifecycle?.failure?.code || "WORKFLOW_CHILD_TERMINAL_FAILURE";
                error.nodeTerminalCommitted = true;
                throw error;
              }
            }
          } catch (error) {
            if (
              nodeStateRepository &&
              nodeIdentity &&
              runningFact?.node &&
              error?.nodeTerminalCommitted !== true &&
              error?.nodeTerminalReceiptRejected !== true
            ) {
              const stopped = isWorkflowAbortError(error, ctx);
              const terminalFact = await commitAndPublishWorkflowNodeState({
                repository: nodeStateRepository,
                options,
                ctx,
                workflowRunId: nodeIdentity.workflowRunId,
                nodeExecutionId: nodeIdentity.nodeExecutionId,
                status: stopped ? WORKFLOW_NODE_STATUS.STOPPED : WORKFLOW_NODE_STATUS.FAILED,
                expectedRevision: runningFact.node.revision,
                nodeSessionId: action?.subSession?.sessionId || "",
                agentDialogProcessId: action?.subSession?.dialogProcessId || "",
                childExecutionId,
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
      nodeStateSnapshot,
      instanceId,
    };
  } catch (error) {
    if (nodeStateRepository && nodeStateSnapshot) {
      const stopped = isWorkflowAbortError(error, ctx);
      nodeStateSnapshot = await settleUnstartedWorkflowNodes({
        repository: nodeStateRepository,
        snapshot: nodeStateSnapshot,
        options,
        ctx,
        status: stopped ? WORKFLOW_NODE_STATUS.STOPPED : WORKFLOW_NODE_STATUS.SKIPPED,
      });
    }
    throw error;
  }
}
