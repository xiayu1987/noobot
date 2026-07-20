/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const WORKFLOW_NODE_STATUS = Object.freeze({
  PENDING: "pending",
  READY: "ready",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  STOPPED: "stopped",
  SKIPPED: "skipped",
});

const TERMINAL_STATUSES = new Set([
  WORKFLOW_NODE_STATUS.SUCCEEDED,
  WORKFLOW_NODE_STATUS.FAILED,
  WORKFLOW_NODE_STATUS.STOPPED,
  WORKFLOW_NODE_STATUS.SKIPPED,
]);

const STARTABLE_STATUSES = new Set([
  WORKFLOW_NODE_STATUS.PENDING,
  WORKFLOW_NODE_STATUS.READY,
]);

const globalWorkflowNodeStateStore = new Map();

function normalizeText(value = "") {
  return String(value || "").trim();
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(status = "") {
  const value = normalizeText(status).toLowerCase();
  return Object.values(WORKFLOW_NODE_STATUS).includes(value) ? value : "";
}

function normalizeFailure(failure = null) {
  if (!failure) return null;
  if (typeof failure === "object") {
    return {
      message: normalizeText(failure.message || failure.reason || failure.code || "workflow node failed"),
      code: normalizeText(failure.code || ""),
      name: normalizeText(failure.name || ""),
    };
  }
  const message = normalizeText(failure);
  return message ? { message } : null;
}

function normalizeIdentity(input = {}) {
  const identity = input && typeof input === "object" ? input : {};
  return {
    workflowRunId: normalizeText(identity.workflowRunId),
    nodeExecutionId: normalizeText(identity.nodeExecutionId),
    commandId: normalizeText(identity.commandId),
    dialogProcessId: normalizeText(identity.dialogProcessId),
    turnScopeId: normalizeText(identity.turnScopeId),
    sessionId: normalizeText(identity.sessionId || identity.nodeSessionId),
    parentSessionId: normalizeText(identity.parentSessionId),
    nodeId: normalizeText(identity.nodeId),
    nodeName: normalizeText(identity.nodeName || identity.name || identity.nodeId),
    attempt: Math.max(1, Math.floor(Number(identity.attempt || 1) || 1)),
    dependencies: Array.isArray(identity.dependencies)
      ? identity.dependencies.map((item) => normalizeText(item)).filter(Boolean)
      : [],
  };
}

function assertIdentity(identity = {}) {
  const missing = ["workflowRunId", "nodeExecutionId", "commandId", "dialogProcessId", "turnScopeId"]
    .filter((field) => !normalizeText(identity[field]));
  if (missing.length) {
    throw new Error(`incomplete workflow node identity/state: ${missing.join(",")}`);
  }
}

function createEventId({ workflowRunId, nodeExecutionId, revision }) {
  return `workflow_node_state:${workflowRunId}:${nodeExecutionId}:${revision}`;
}

function createInitialNodeRecord({ node = {}, sequence = 0, timestamp = nowIso() } = {}) {
  const identity = normalizeIdentity(node);
  assertIdentity(identity);
  const status = normalizeStatus(node.stepStatus || node.status) || WORKFLOW_NODE_STATUS.PENDING;
  if (![WORKFLOW_NODE_STATUS.PENDING, WORKFLOW_NODE_STATUS.READY].includes(status)) {
    throw new Error(`invalid initial workflow node status: ${status}`);
  }
  return {
    ...identity,
    status,
    revision: 1,
    sequence,
    eventId: createEventId({
      workflowRunId: identity.workflowRunId,
      nodeExecutionId: identity.nodeExecutionId,
      revision: 1,
    }),
    failure: null,
    startedAt: "",
    completedAt: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function cloneRun(run = {}) {
  return {
    workflowRunId: normalizeText(run.workflowRunId),
    sequence: Number(run.sequence || 0),
    nodes: new Map(Array.from(run.nodes || []).map(([key, value]) => [key, cloneJson(value)])),
  };
}

function toSnapshot(run = {}) {
  const nodes = Array.from(run.nodes?.values?.() || []).map((item) => cloneJson(item));
  nodes.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  return {
    workflowRunId: normalizeText(run.workflowRunId),
    sequence: Number(run.sequence || 0),
    nodes,
  };
}

function isSameTarget(current = {}, next = {}) {
  return normalizeStatus(current.status) === normalizeStatus(next.status)
    && normalizeText(current.sessionId) === normalizeText(next.sessionId || next.nodeSessionId)
    && JSON.stringify(current.failure || null) === JSON.stringify(normalizeFailure(next.failure));
}

function assertLegalTransition(current = {}, status = "") {
  const currentStatus = normalizeStatus(current.status);
  const nextStatus = normalizeStatus(status);
  if (!nextStatus) throw new Error("invalid workflow node status");
  if (TERMINAL_STATUSES.has(currentStatus)) {
    if (currentStatus === nextStatus) return;
    throw new Error(`workflow node ${current.nodeExecutionId} is terminal and cannot transition to ${nextStatus}`);
  }
  if (nextStatus === WORKFLOW_NODE_STATUS.RUNNING) {
    if (!STARTABLE_STATUSES.has(currentStatus)) {
      throw new Error(`workflow node ${current.nodeExecutionId} cannot transition from ${currentStatus} to running`);
    }
    return;
  }
  if (TERMINAL_STATUSES.has(nextStatus)) {
    if (currentStatus !== WORKFLOW_NODE_STATUS.RUNNING) {
      throw new Error(`workflow node ${current.nodeExecutionId} cannot transition from ${currentStatus} to ${nextStatus}`);
    }
    return;
  }
  throw new Error(`unsupported workflow node transition to ${nextStatus}`);
}

export function createInMemoryWorkflowNodeStateRepository({ initialState = null } = {}) {
  const runs = new Map();
  if (initialState instanceof Map) {
    for (const [key, value] of initialState.entries()) runs.set(key, cloneRun(value));
  } else if (initialState && typeof initialState === "object") {
    for (const [key, value] of Object.entries(initialState)) {
      const run = {
        workflowRunId: normalizeText(value.workflowRunId || key),
        sequence: Number(value.sequence || 0),
        nodes: new Map((Array.isArray(value.nodes) ? value.nodes : []).map((node) => [normalizeText(node.nodeExecutionId), cloneJson(node)])),
      };
      runs.set(key, run);
    }
  }

  function getRun(workflowRunId = "") {
    return runs.get(normalizeText(workflowRunId)) || null;
  }

  return {
    async initialize({ workflowRunId = "", planningNodeSessions = [] } = {}) {
      const runId = normalizeText(workflowRunId || planningNodeSessions?.[0]?.workflowRunId);
      if (!runId) throw new Error("workflowRunId is required");
      if (!Array.isArray(planningNodeSessions) || !planningNodeSessions.length) {
        throw new Error("planningNodeSessions are required");
      }
      const existing = getRun(runId);
      if (existing) return toSnapshot(existing);
      const timestamp = nowIso();
      let sequence = 0;
      const nodes = new Map();
      for (const node of planningNodeSessions) {
        sequence += 1;
        const record = createInitialNodeRecord({ node, sequence, timestamp });
        if (nodes.has(record.nodeExecutionId)) {
          throw new Error(`duplicate workflow node identity/state: ${record.nodeExecutionId}`);
        }
        nodes.set(record.nodeExecutionId, record);
      }
      const run = { workflowRunId: runId, sequence, nodes };
      runs.set(runId, run);
      return toSnapshot(run);
    },

    async commit({ workflowRunId = "", nodeExecutionId = "", status = "", expectedRevision = null, sessionId = "", failure = null } = {}) {
      const runId = normalizeText(workflowRunId);
      const executionId = normalizeText(nodeExecutionId);
      const run = getRun(runId);
      if (!run) throw new Error(`workflow node state run not initialized: ${runId}`);
      const current = run.nodes.get(executionId);
      if (!current) throw new Error(`workflow node state not found: ${executionId}`);
      const nextStatus = normalizeStatus(status);
      if (expectedRevision != null && Number(expectedRevision) !== Number(current.revision)) {
        if (isSameTarget(current, { status: nextStatus, sessionId, failure })) {
          return { applied: false, deduplicated: true, node: cloneJson(current), snapshot: toSnapshot(run) };
        }
        throw new Error(`workflow node revision conflict: expected ${expectedRevision}, actual ${current.revision}`);
      }
      if (isSameTarget(current, { status: nextStatus, sessionId, failure })) {
        return { applied: false, deduplicated: true, node: cloneJson(current), snapshot: toSnapshot(run) };
      }
      assertLegalTransition(current, nextStatus);
      const timestamp = nowIso();
      const revision = Number(current.revision || 0) + 1;
      const sequence = Number(run.sequence || 0) + 1;
      const next = {
        ...current,
        status: nextStatus,
        revision,
        sequence,
        eventId: createEventId({ workflowRunId: runId, nodeExecutionId: executionId, revision }),
        sessionId: normalizeText(sessionId || current.sessionId),
        failure: normalizeFailure(failure),
        startedAt: current.startedAt || (nextStatus === WORKFLOW_NODE_STATUS.RUNNING ? timestamp : ""),
        completedAt: TERMINAL_STATUSES.has(nextStatus) ? timestamp : current.completedAt || "",
        updatedAt: timestamp,
      };
      run.sequence = sequence;
      run.nodes.set(executionId, next);
      return { applied: true, deduplicated: false, node: cloneJson(next), snapshot: toSnapshot(run) };
    },

    async getSnapshot({ workflowRunId = "" } = {}) {
      const run = getRun(workflowRunId);
      return run ? toSnapshot(run) : null;
    },

    exportState() {
      return new Map(Array.from(runs.entries()).map(([key, value]) => [key, cloneRun(value)]));
    },
  };
}

let defaultRepository = null;

export function getDefaultWorkflowNodeStateRepository() {
  if (!defaultRepository) {
    defaultRepository = createInMemoryWorkflowNodeStateRepository({ initialState: globalWorkflowNodeStateStore });
  }
  return defaultRepository;
}

export function resolveWorkflowNodeStateRepository(options = {}) {
  const candidate = options?.workflowNodeStateRepository;
  if (
    candidate
    && typeof candidate.initialize === "function"
    && typeof candidate.commit === "function"
    && typeof candidate.getSnapshot === "function"
  ) {
    return candidate;
  }
  return createInMemoryWorkflowNodeStateRepository();
}
