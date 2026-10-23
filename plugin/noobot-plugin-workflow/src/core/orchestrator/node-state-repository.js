/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  WORKFLOW_NODE_STATUS,
  isWorkflowNodeTerminalStatus,
  normalizeWorkflowNodeStatus,
} from "@noobot/event-protocol/workflow-runtime-event";
import { isCanonicalText } from "@noobot/shared/value";

export { WORKFLOW_NODE_STATUS };

const STARTABLE_STATUSES = new Set([WORKFLOW_NODE_STATUS.PENDING, WORKFLOW_NODE_STATUS.READY]);

const FAILURE_STATUSES = new Set([WORKFLOW_NODE_STATUS.FAILED, WORKFLOW_NODE_STATUS.STOPPED]);

const NODE_IDENTITY_TEXT_FIELDS = Object.freeze([
  "workflowRunId",
  "nodeExecutionId",
  "commandId",
  "dialogProcessId",
  "turnScopeId",
  "activeChildExecutionId",
  "nodeId",
  "nodeName",
]);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function requireFailureBinding(nextStatus, failure) {
  if (!FAILURE_STATUSES.has(nextStatus)) {
    if (failure !== undefined) {
      throw new Error(`workflow node failure is carried only by failed/stopped, not ${nextStatus}`);
    }
    return null;
  }
  if (
    !isCanonicalText(failure?.source) ||
    !isCanonicalText(failure?.code) ||
    !isCanonicalText(failure?.message)
  ) {
    throw new Error("workflow node failure requires source, code and message");
  }
  return { source: failure.source, code: failure.code, message: failure.message };
}

function requireNodeIdentity(node) {
  const missing = NODE_IDENTITY_TEXT_FIELDS.filter((field) => !isCanonicalText(node?.[field]));
  if (!Number.isInteger(node?.attempt) || node.attempt < 1) missing.push("attempt");
  if (!Array.isArray(node?.dependencies) || !node.dependencies.every(isCanonicalText)) {
    missing.push("dependencies");
  }
  if (missing.length) {
    throw new Error(`incomplete workflow node identity/state: ${missing.join(",")}`);
  }
  const identity = { attempt: node.attempt, dependencies: [...node.dependencies] };
  for (const field of NODE_IDENTITY_TEXT_FIELDS) identity[field] = node[field];
  return identity;
}

function createEventId({ workflowRunId, nodeExecutionId, revision }) {
  return `workflow_node_state:${workflowRunId}:${nodeExecutionId}:${revision}`;
}

function createInitialNodeRecord({ node, sequence, timestamp }) {
  const identity = requireNodeIdentity(node);
  if (!STARTABLE_STATUSES.has(node.status)) {
    throw new Error(`invalid initial workflow node status: ${node.status}`);
  }
  return {
    ...identity,
    status: node.status,
    revision: 1,
    sequence,
    eventId: createEventId({ ...identity, revision: 1 }),
    nodeSessionId: "",
    attemptExecutionIds: [],
    failure: null,
    startedAt: "",
    completedAt: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toSnapshot(run) {
  const nodes = Array.from(run.nodes.values()).map(cloneJson);
  nodes.sort((a, b) => a.sequence - b.sequence);
  return { workflowRunId: run.workflowRunId, sequence: run.sequence, nodes };
}

function assertLegalTransition(current, nextStatus) {
  const currentStatus = current.status;
  if (isWorkflowNodeTerminalStatus(currentStatus)) {
    throw new Error(
      `workflow node ${current.nodeExecutionId} is terminal and cannot transition to ${nextStatus}`,
    );
  }
  if (nextStatus === WORKFLOW_NODE_STATUS.RUNNING) {
    if (STARTABLE_STATUSES.has(currentStatus)) return;
  } else if (isWorkflowNodeTerminalStatus(nextStatus)) {
    const maySettleWithoutStarting =
      STARTABLE_STATUSES.has(currentStatus) &&
      [WORKFLOW_NODE_STATUS.STOPPED, WORKFLOW_NODE_STATUS.SKIPPED].includes(nextStatus);
    if (currentStatus === WORKFLOW_NODE_STATUS.RUNNING || maySettleWithoutStarting) return;
  }
  throw new Error(
    `workflow node ${current.nodeExecutionId} cannot transition from ${currentStatus} to ${nextStatus}`,
  );
}

function assertSessionBinding(nextStatus, nodeSessionId) {
  const starting = nextStatus === WORKFLOW_NODE_STATUS.RUNNING;
  if (starting && !isCanonicalText(nodeSessionId)) {
    throw new Error("workflow node running transition requires nodeSessionId");
  }
  if (!starting && nodeSessionId !== undefined) {
    throw new Error("workflow node nodeSessionId is bound only by the running transition");
  }
}

function applyTransition({ current, run, nextStatus, nodeSessionId, failure }) {
  const timestamp = nowIso();
  const revision = current.revision + 1;
  const starting = nextStatus === WORKFLOW_NODE_STATUS.RUNNING;
  return {
    ...current,
    status: nextStatus,
    revision,
    sequence: run.sequence + 1,
    eventId: createEventId({ ...current, revision }),
    nodeSessionId: starting ? nodeSessionId : current.nodeSessionId,
    attemptExecutionIds: starting
      ? [...current.attemptExecutionIds, current.activeChildExecutionId]
      : current.attemptExecutionIds,
    failure,
    startedAt: starting ? timestamp : current.startedAt,
    completedAt: isWorkflowNodeTerminalStatus(nextStatus) ? timestamp : current.completedAt,
    updatedAt: timestamp,
  };
}

export function createInMemoryWorkflowNodeStateRepository() {
  const runs = new Map();

  function requireRun(workflowRunId) {
    const run = runs.get(workflowRunId);
    if (!run) throw new Error(`workflow node state run not initialized: ${workflowRunId}`);
    return run;
  }

  return {
    async initialize({ workflowRunId, planningNodeSessions }) {
      if (!isCanonicalText(workflowRunId)) throw new Error("workflowRunId is required");
      if (!Array.isArray(planningNodeSessions) || !planningNodeSessions.length) {
        throw new Error("planningNodeSessions are required");
      }
      const existing = runs.get(workflowRunId);
      if (existing) return toSnapshot(existing);
      const timestamp = nowIso();
      const nodes = new Map();
      for (const node of planningNodeSessions) {
        if (node?.workflowRunId !== workflowRunId) {
          throw new Error(`workflow node identity belongs to another run: ${node?.workflowRunId}`);
        }
        const record = createInitialNodeRecord({ node, sequence: nodes.size + 1, timestamp });
        if (nodes.has(record.nodeExecutionId)) {
          throw new Error(`duplicate workflow node identity/state: ${record.nodeExecutionId}`);
        }
        nodes.set(record.nodeExecutionId, record);
      }
      const run = { workflowRunId, sequence: nodes.size, nodes };
      runs.set(workflowRunId, run);
      return toSnapshot(run);
    },

    async commit({
      workflowRunId,
      nodeExecutionId,
      status,
      expectedRevision,
      nodeSessionId,
      failure,
    }) {
      const run = requireRun(workflowRunId);
      const current = run.nodes.get(nodeExecutionId);
      if (!current) throw new Error(`workflow node state not found: ${nodeExecutionId}`);
      const nextStatus = normalizeWorkflowNodeStatus(status);
      if (!nextStatus) throw new Error(`invalid workflow node status: ${status}`);
      if (!Number.isInteger(expectedRevision)) {
        throw new Error("workflow node commit requires integer expectedRevision");
      }
      assertSessionBinding(nextStatus, nodeSessionId);
      const nextFailure = requireFailureBinding(nextStatus, failure);
      if (expectedRevision !== current.revision) {
        throw new Error(
          `workflow node revision conflict: expected ${expectedRevision}, actual ${current.revision}`,
        );
      }
      assertLegalTransition(current, nextStatus);
      const next = applyTransition({
        current,
        run,
        nextStatus,
        nodeSessionId,
        failure: nextFailure,
      });
      run.sequence = next.sequence;
      run.nodes.set(nodeExecutionId, next);
      return { node: cloneJson(next), snapshot: toSnapshot(run) };
    },

    async getSnapshot({ workflowRunId }) {
      return toSnapshot(requireRun(workflowRunId));
    },
  };
}
