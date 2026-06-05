/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import Business from '../engine/bizinst/business.js';
import BizinstTreeControlCenter from '../engine/bizinstcontrolcenter/bizinst-tree-control-center.js';
import SubmitAction from '../engine/bizinst/action/submit-action.js';
import AuditAction from '../engine/bizinst/action/audit-action.js';
import BackAction from '../engine/bizinst/action/back-action.js';
import StopAction from '../engine/bizinst/action/stop-action.js';
import { compileWorkflowSemantic } from './compiler.js';
const WORKFLOW_INSTANCE_STORE = new Map();
let WORKFLOW_RUNTIME_ID_COUNTER = 0;

function createActionByType(type = "") {
  const key = String(type || "submit").trim().toLowerCase();
  if (key === "audit") return new AuditAction();
  if (key === "back") return new BackAction();
  if (key === "stop") return new StopAction();
  return new SubmitAction();
}

function snapshotCurrentSteps(bizinst = null) {
  return Array.isArray(bizinst?.getState?.()?.getCurrentState?.()?.getCurrentStepStates?.())
    ? bizinst.getState().getCurrentState().getCurrentStepStates()
    : [];
}

function summarizeActionRecords(treeRecord = null) {
  const records = Array.isArray(treeRecord?.getActionRecords?.()) ? treeRecord.getActionRecords() : [];
  return records.map((record) => {
    const action = record?.getAction?.();
    return {
      actionName: String(action?.getName?.() || action?.constructor?.name || "").trim(),
      actionType: String(action?.constructor?.name || "").trim(),
    };
  });
}

function normalizeWorkflowStepRuntime(input = null) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function getStepStateWorkflowRuntime(stepState = null) {
  const dataContext = normalizeWorkflowStepRuntime(stepState?.getDataContext?.());
  return normalizeWorkflowStepRuntime(dataContext.workflowRuntime);
}

function nextWorkflowRuntimeId(prefix = "wf_rt") {
  WORKFLOW_RUNTIME_ID_COUNTER += 1;
  return `${prefix}_${Date.now()}_${WORKFLOW_RUNTIME_ID_COUNTER}`;
}

function setStepStateWorkflowRuntime(stepState = null, patch = {}) {
  if (!stepState || typeof stepState?.setDataContext !== "function") return null;
  const dataContext = normalizeWorkflowStepRuntime(stepState?.getDataContext?.());
  const current = normalizeWorkflowStepRuntime(dataContext.workflowRuntime);
  const next = {
    ...dataContext,
    workflowRuntime: {
      ...current,
      ...(patch && typeof patch === "object" ? patch : {}),
      updatedAt: new Date().toISOString(),
    },
  };
  stepState.setDataContext(next);
  return next.workflowRuntime;
}

function getNodeStateWorkflowRuntime(nodeState = null) {
  const dataContext = normalizeWorkflowStepRuntime(nodeState?.getDataContext?.());
  return normalizeWorkflowStepRuntime(dataContext.workflowRuntime);
}

function setNodeStateWorkflowRuntime(nodeState = null, patch = {}) {
  if (!nodeState || typeof nodeState?.setDataContext !== "function") return null;
  const dataContext = normalizeWorkflowStepRuntime(nodeState?.getDataContext?.());
  const current = normalizeWorkflowStepRuntime(dataContext.workflowRuntime);
  const next = {
    ...dataContext,
    workflowRuntime: {
      ...current,
      ...(patch && typeof patch === "object" ? patch : {}),
      updatedAt: new Date().toISOString(),
    },
  };
  nodeState.setDataContext(next);
  return next.workflowRuntime;
}

function ensureActionNodeStateRuntimeId(actionNodeState = null) {
  if (!actionNodeState) return "";
  const current = getNodeStateWorkflowRuntime(actionNodeState);
  const existing = String(current?.actionNodeStateId || current?.nodeStateId || "").trim();
  if (existing) return existing;
  const id = nextWorkflowRuntimeId("wf_action_state");
  setNodeStateWorkflowRuntime(actionNodeState, {
    nodeStateId: id,
    actionNodeStateId: id,
  });
  return id;
}

function ensureStepStateRuntimeId(stepState = null) {
  if (!stepState) return "";
  const current = getStepStateWorkflowRuntime(stepState);
  const existing = String(current?.stepId || "").trim();
  if (existing) return existing;
  const actionNodeState = stepState?.getActionNodeState?.() || null;
  const actionNodeStateId = ensureActionNodeStateRuntimeId(actionNodeState);
  const id = nextWorkflowRuntimeId("wf_step");
  setStepStateWorkflowRuntime(stepState, {
    stepId: id,
    actionNodeStateId,
  });
  return id;
}

function markStepStateFailure(stepState = null, failure = {}) {
  const normalizedFailure = failure && typeof failure === "object" ? failure : {};
  return setStepStateWorkflowRuntime(stepState, {
    status: "failed",
    failure: {
      source: String(normalizedFailure?.source || "workflow_node_agent").trim(),
      code: String(normalizedFailure?.code || "WORKFLOW_NODE_AGENT_FAILED").trim(),
      message: String(normalizedFailure?.message || "workflow node agent failed").trim(),
      ...(normalizedFailure?.detail && typeof normalizedFailure.detail === "object"
        ? { detail: normalizedFailure.detail }
        : {}),
    },
  });
}

export function startWorkflowInstance({ model = null, conditionContext = null } = {}) {
  const business = new Business();
  if (conditionContext && typeof conditionContext === "object") {
    business.conditionContext = { ...conditionContext };
  }
  const controlCenter = new BizinstTreeControlCenter();
  const startResult = controlCenter.startBizinst(business, model);
  return {
    business,
    controlCenter,
    startResult,
    bizinst: startResult?.getBizinst?.() || null,
    treeRecord: startResult?.getBizinstTreeRecord?.() || null,
  };
}

export function advanceWorkflowInstance({
  bizinst = null,
  treeRecord = null,
  controlCenter = null,
  semantic = {},
  options = {},
} = {}) {
  const actionPlan = Array.isArray(semantic?.autoActions) && semantic.autoActions.length
    ? semantic.autoActions
    : options?.autoSubmit === false
      ? []
      : [{ type: "submit", stepIndex: 0 }];

  const maxAutoTransitions = Number.isFinite(Number(options?.maxAutoTransitions))
    ? Math.max(1, Math.floor(Number(options.maxAutoTransitions)))
    : 10;

  const executedActions = [];
  let transitions = 0;
  while (transitions < maxAutoTransitions) {
    const steps = snapshotCurrentSteps(bizinst);
    if (!steps.length) break;
    const directive = actionPlan[Math.min(transitions, actionPlan.length - 1)] || {
      type: "submit",
      stepIndex: 0,
    };
    const stepIndex = Number.isFinite(Number(directive?.stepIndex))
      ? Math.max(0, Math.floor(Number(directive.stepIndex)))
      : 0;
    const safeIndex = Math.min(stepIndex, steps.length - 1);
    const action = createActionByType(directive?.type);
    controlCenter.execAction(action, bizinst, steps[safeIndex], treeRecord);
    transitions += 1;
    executedActions.push({
      type: String(directive?.type || "submit").trim().toLowerCase(),
      stepIndex: safeIndex,
      remainingSteps: snapshotCurrentSteps(bizinst).length,
    });
    if (!actionPlan.length && options?.autoSubmit === false) break;
    if (actionPlan.length && transitions >= actionPlan.length) break;
  }

  const finalSteps = snapshotCurrentSteps(bizinst);
  return {
    autoTransitions: transitions,
    completed: finalSteps.length === 0,
    pendingStepCount: finalSteps.length,
    executedActions,
    actionRecords: summarizeActionRecords(treeRecord),
  };
}

export function executeWorkflowSemantic({ semantic = {}, options = {} } = {}) {
  const model = compileWorkflowSemantic(semantic);
  const started = startWorkflowInstance({ model });
  const progress = advanceWorkflowInstance({
    bizinst: started.bizinst,
    treeRecord: started.treeRecord,
    controlCenter: started.controlCenter,
    semantic,
    options,
  });
  return {
    started: Boolean(started.startResult),
    ...progress,
  };
}

function resolveInstanceId(input = "") {
  const normalized = String(input || "").trim();
  if (normalized) return normalized;
  return `wf_inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function describePendingSteps(bizinst = null) {
  const steps = snapshotCurrentSteps(bizinst);
  return steps.map((stepState, index) => {
    const actionNodeState = stepState?.getActionNodeState?.();
    const node = actionNodeState?.getNode?.();
    const stepStates = Array.isArray(actionNodeState?.getStepStates?.())
      ? actionNodeState.getStepStates()
      : [];
    const workflowRuntime = getStepStateWorkflowRuntime(stepState);
    const stepId = ensureStepStateRuntimeId(stepState);
    const actionNodeStateId = ensureActionNodeStateRuntimeId(actionNodeState);
    return {
      index,
      nodeId: String(node?.workflowNodeId || "").trim(),
      nodeName: String(node?.getName?.() || "").trim(),
      nodeType: Number(node?.getNodeType?.()),
      actionNodeStateId,
      stepId,
      stepIndex: stepStates.indexOf(stepState),
      stepStatus: String(workflowRuntime?.status || "").trim(),
      stepFailure: workflowRuntime?.failure && typeof workflowRuntime.failure === "object"
        ? workflowRuntime.failure
        : null,
    };
  });
}

function describeActionStepState(stepState = null) {
  const actionNodeState = stepState?.getActionNodeState?.() || null;
  const node = actionNodeState?.getNode?.() || null;
  const stepStates = Array.isArray(actionNodeState?.getStepStates?.())
    ? actionNodeState.getStepStates()
    : [];
  const workflowRuntime = getStepStateWorkflowRuntime(stepState);
  return {
    nodeId: String(node?.workflowNodeId || "").trim(),
    nodeName: String(node?.getName?.() || "").trim(),
    nodeType: Number(node?.getNodeType?.()),
    actionNodeStateId: ensureActionNodeStateRuntimeId(actionNodeState),
    stepId: ensureStepStateRuntimeId(stepState),
    stepIndex: stepStates.indexOf(stepState),
    stepStatus: String(workflowRuntime?.status || "").trim(),
    stepFailure:
      workflowRuntime?.failure && typeof workflowRuntime.failure === "object"
        ? workflowRuntime.failure
        : null,
  };
}

function findCurrentStepState({ record = null, pendingStep = {}, stepId = "" } = {}) {
  const steps = snapshotCurrentSteps(record?.bizinst || null);
  const normalizedStepId = String(stepId || pendingStep?.stepId || "").trim();
  if (normalizedStepId) {
    const matchedById = steps.find((stepState) => ensureStepStateRuntimeId(stepState) === normalizedStepId);
    if (matchedById) return matchedById;
  }
  const index = Number(pendingStep?.index);
  if (Number.isFinite(index) && index >= 0 && steps[Math.floor(index)]) {
    return steps[Math.floor(index)];
  }
  const nodeId = String(pendingStep?.nodeId || "").trim();
  const stepIndex = Number(pendingStep?.stepIndex);
  if (nodeId && Number.isFinite(stepIndex)) {
    return (
      steps.find((stepState) => {
        const actionNodeState = stepState?.getActionNodeState?.();
        const node = actionNodeState?.getNode?.();
        if (String(node?.workflowNodeId || "").trim() !== nodeId) return false;
        const stepStates = Array.isArray(actionNodeState?.getStepStates?.())
          ? actionNodeState.getStepStates()
          : [];
        return stepStates.indexOf(stepState) === Math.floor(stepIndex);
      }) || null
    );
  }
  return null;
}

function isRuntimeActionNodeState(nodeState = null) {
  return Array.isArray(nodeState?.getStepStates?.());
}

function isRuntimeStateNodeState(nodeState = null) {
  return typeof nodeState?.getNode?.()?.getStateType === "function";
}

function collectIncomingStartNodeStates(nodeState = null) {
  const model = nodeState?.getBizinstModel?.();
  const pathStates = Array.isArray(model?.getPathStates?.()) ? model.getPathStates() : [];
  const node = nodeState?.getNode?.() || null;
  const isMergeState = Number(node?.getStateType?.()) === 3;
  const equivalentEndNodeStates = new Set([nodeState]);
  if (isMergeState) {
    const stateNodeStates = Array.isArray(model?.getStateNodeStates?.())
      ? model.getStateNodeStates()
      : [];
    for (const stateNodeState of stateNodeStates) {
      if (stateNodeState?.getNode?.() === node) {
        equivalentEndNodeStates.add(stateNodeState);
      }
    }
  }
  return pathStates
    .filter((pathState) => equivalentEndNodeStates.has(pathState?.getEndNodeState?.()))
    .map((pathState) => pathState?.getStartNodeState?.())
    .filter(Boolean);
}

function resolveUpstreamActionNodeStatesFromRuntime(nodeState = null) {
  const collected = [];
  const collectedSet = new Set();
  const visited = new Set();

  function visit(currentNodeState = null) {
    if (!currentNodeState || visited.has(currentNodeState)) return;
    visited.add(currentNodeState);
    const starts = collectIncomingStartNodeStates(currentNodeState);
    for (const startNodeState of starts) {
      if (!startNodeState) continue;
      if (isRuntimeActionNodeState(startNodeState)) {
        const id = ensureActionNodeStateRuntimeId(startNodeState);
        if (!collectedSet.has(id)) {
          collectedSet.add(id);
          collected.push(startNodeState);
        }
        continue;
      }
      if (isRuntimeStateNodeState(startNodeState)) {
        visit(startNodeState);
      }
    }
  }

  visit(nodeState);
  return collected;
}

export function resolveWorkflowUpstreamActionSteps({
  instanceId = "",
  pendingStep = {},
  stepId = "",
} = {}) {
  const record = getWorkflowInstanceRecord({ instanceId });
  if (!record) return [];
  const currentStepState = findCurrentStepState({ record, pendingStep, stepId });
  const currentActionNodeState = currentStepState?.getActionNodeState?.() || null;
  if (!currentActionNodeState) return [];
  const upstreamActionNodeStates = resolveUpstreamActionNodeStatesFromRuntime(currentActionNodeState);
  return upstreamActionNodeStates.flatMap((actionNodeState) => {
    const stepStates = Array.isArray(actionNodeState?.getStepStates?.())
      ? actionNodeState.getStepStates()
      : [];
    return stepStates.map((stepState) => describeActionStepState(stepState));
  });
}

function normalizeSemanticNodeId(input = "") {
  return String(input || "").trim();
}

function isSemanticActionNode(node = null) {
  if (!node || typeof node !== "object") return false;
  return String(node?.type || "").trim().toLowerCase() === "action";
}

function isSemanticStateNode(node = null) {
  if (!node || typeof node !== "object") return false;
  return String(node?.type || "").trim().toLowerCase() === "state";
}

function buildSemanticRelationIndex(semantic = {}) {
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  const flowtos = Array.isArray(semantic?.flowtos) ? semantic.flowtos : [];
  const nodeById = new Map();
  const incomingById = new Map();

  for (const node of nodes) {
    const id = normalizeSemanticNodeId(node?.id);
    if (id) nodeById.set(id, node);
  }

  for (const flowto of flowtos) {
    const from = normalizeSemanticNodeId(flowto?.from);
    const to = normalizeSemanticNodeId(flowto?.to);
    if (!from || !to) continue;
    const incoming = incomingById.get(to) || [];
    incoming.push({ from, to, flowto });
    incomingById.set(to, incoming);
  }

  return { nodeById, incomingById };
}

function resolveSemanticFromInput({ semantic = null, instanceId = "" } = {}) {
  if (semantic && typeof semantic === "object") return semantic;
  const record = getWorkflowInstanceRecord({ instanceId });
  return record?.semantic && typeof record.semantic === "object" ? record.semantic : {};
}

function resolveNodeIdFromInput({ semantic = {}, nodeId = "", pendingStep = {} } = {}) {
  const direct = normalizeSemanticNodeId(nodeId || pendingStep?.nodeId);
  if (direct) return direct;
  const nodeName = String(pendingStep?.nodeName || "").trim();
  if (!nodeName) return "";
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  const matched = nodes.find((node = {}) => String(node?.name || "").trim() === nodeName);
  return normalizeSemanticNodeId(matched?.id);
}

export function resolveWorkflowUpstreamActionNodes({
  semantic = null,
  instanceId = "",
  nodeId = "",
  pendingStep = {},
} = {}) {
  const resolvedSemantic = resolveSemanticFromInput({ semantic, instanceId });
  const startNodeId = resolveNodeIdFromInput({
    semantic: resolvedSemantic,
    nodeId,
    pendingStep,
  });
  if (!startNodeId) return [];

  const { nodeById, incomingById } = buildSemanticRelationIndex(resolvedSemantic);
  const collected = [];
  const collectedSet = new Set();
  const visited = new Set();

  function visit(currentId = "") {
    const id = normalizeSemanticNodeId(currentId);
    if (!id || visited.has(id)) return;
    visited.add(id);
    const incoming = incomingById.get(id) || [];
    for (const edge of incoming) {
      const fromId = normalizeSemanticNodeId(edge?.from);
      if (!fromId) continue;
      const fromNode = nodeById.get(fromId) || null;
      if (isSemanticActionNode(fromNode)) {
        if (!collectedSet.has(fromId)) {
          collectedSet.add(fromId);
          collected.push({
            nodeId: fromId,
            nodeName: String(fromNode?.name || fromId).trim(),
            nodeType: "action",
            node: fromNode,
          });
        }
        continue;
      }
      if (isSemanticStateNode(fromNode)) {
        visit(fromId);
      }
    }
  }

  visit(startNodeId);
  return collected;
}

export function startWorkflowInstanceById({ instanceId = "", semantic = {}, options = {}, meta = {} } = {}) {
  const id = resolveInstanceId(instanceId);
  const model = compileWorkflowSemantic(semantic);
  const conditionContext =
    options?.conditionContext && typeof options.conditionContext === "object"
      ? options.conditionContext
      : meta?.conditionContext && typeof meta.conditionContext === "object"
        ? meta.conditionContext
        : null;
  const started = startWorkflowInstance({ model, conditionContext });
  const record = {
    instanceId: id,
    semantic,
    options,
    meta,
    createdAt: new Date().toISOString(),
    business: started.business,
    controlCenter: started.controlCenter,
    startResult: started.startResult,
    bizinst: started.bizinst,
    treeRecord: started.treeRecord,
    transitions: 0,
  };
  if (conditionContext) {
    record.business.conditionContext = {
      ...(record.business.conditionContext && typeof record.business.conditionContext === "object"
        ? record.business.conditionContext
        : {}),
      ...conditionContext,
    };
  }
  WORKFLOW_INSTANCE_STORE.set(id, record);
  return getWorkflowInstanceSnapshot({ instanceId: id });
}

function getWorkflowInstanceRecord({ instanceId = "" } = {}) {
  const id = String(instanceId || "").trim();
  if (!id) return null;
  return WORKFLOW_INSTANCE_STORE.get(id) || null;
}

export function getWorkflowInstanceSnapshot({ instanceId = "" } = {}) {
  const record = getWorkflowInstanceRecord({ instanceId });
  if (!record) return null;
  const pendingSteps = describePendingSteps(record.bizinst);
  return {
    instanceId: record.instanceId,
    createdAt: record.createdAt,
    transitions: record.transitions,
    completed: pendingSteps.length === 0,
    pendingStepCount: pendingSteps.length,
    pendingSteps,
    actionRecords: summarizeActionRecords(record.treeRecord),
  };
}

export function advanceWorkflowInstanceById({
  instanceId = "",
  action = { type: "submit", stepIndex: 0 },
} = {}) {
  const record = getWorkflowInstanceRecord({ instanceId });
  if (!record) {
    throw new Error(`workflow instance not found: ${String(instanceId || "").trim()}`);
  }
  const steps = snapshotCurrentSteps(record.bizinst);
  if (!steps.length) return getWorkflowInstanceSnapshot({ instanceId: record.instanceId });
  const rawStepIndex = Number(action?.stepIndex);
  const stepIndex = Number.isFinite(rawStepIndex) ? Math.max(0, Math.floor(rawStepIndex)) : 0;
  const safeIndex = Math.min(stepIndex, steps.length - 1);
  if (action?.stepFailure && typeof action.stepFailure === "object") {
    markStepStateFailure(steps[safeIndex], action.stepFailure);
  }
  const runtimeAction = createActionByType(action?.type);
  record.controlCenter.execAction(runtimeAction, record.bizinst, steps[safeIndex], record.treeRecord);
  record.transitions += 1;
  return getWorkflowInstanceSnapshot({ instanceId: record.instanceId });
}

export function releaseWorkflowInstance({ instanceId = "" } = {}) {
  const id = String(instanceId || "").trim();
  if (!id) return false;
  return WORKFLOW_INSTANCE_STORE.delete(id);
}

export default {
  startWorkflowInstance,
  advanceWorkflowInstance,
  executeWorkflowSemantic,
  startWorkflowInstanceById,
  getWorkflowInstanceSnapshot,
  resolveWorkflowUpstreamActionNodes,
  resolveWorkflowUpstreamActionSteps,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance,
};
