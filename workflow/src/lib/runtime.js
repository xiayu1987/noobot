/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import Business from "../engine/bizinst/business.js";
import BizinstTreeControlCenter from "../engine/bizinstcontrolcenter/bizinst-tree-control-center.js";
import SubmitAction from "../engine/bizinst/action/submit-action.js";
import AuditAction from "../engine/bizinst/action/audit-action.js";
import BackAction from "../engine/bizinst/action/back-action.js";
import StopAction from "../engine/bizinst/action/stop-action.js";
import { compileWorkflowSemantic } from "./compiler.js";
import { randomUUID } from "node:crypto";
import { isPlainObject, text, isFunction, isObjectLike } from "@noobot/shared/value";
const WORKFLOW_INSTANCE_STORE = new Map();
let WORKFLOW_RUNTIME_ID_COUNTER = 0;

const RUNTIME_ACTION_FACTORIES = Object.freeze({
  submit: () => new SubmitAction(),
  audit: () => new AuditAction(),
  back: () => new BackAction(),
  stop: () => new StopAction(),
});

function createActionByType(type) {
  if (!Object.hasOwn(RUNTIME_ACTION_FACTORIES, type)) {
    throw new Error(`workflow action type invalid: ${type}`);
  }
  return RUNTIME_ACTION_FACTORIES[type]();
}

function snapshotCurrentSteps(bizinst = null) {
  return Array.isArray(bizinst?.getState?.()?.getCurrentState?.()?.getCurrentStepStates?.())
    ? bizinst.getState().getCurrentState().getCurrentStepStates()
    : [];
}

function summarizeActionRecords(treeRecord = null) {
  const records = Array.isArray(treeRecord?.getActionRecords?.())
    ? treeRecord.getActionRecords()
    : [];
  return records.map((record) => {
    const action = record?.getAction?.();
    return {
      actionName: text(action?.getName?.()),
      actionKind: text(action?.getActionKind?.()),
    };
  });
}

function normalizeWorkflowStepRuntime(input = null) {
  return isPlainObject(input) ? input : {};
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
  const existing = text(current?.actionNodeStateId || current?.nodeStateId);
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
  const existing = text(current?.stepId);
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

export function startWorkflowInstance({ model = null, conditionContext = null } = {}) {
  const business = new Business();
  if (isObjectLike(conditionContext)) {
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

function resolveInstanceId(input = "") {
  const normalized = text(input);
  if (normalized) return normalized;
  return `wf_inst_${randomUUID()}`;
}

function describePendingSteps(bizinst = null) {
  const steps = snapshotCurrentSteps(bizinst);
  return steps.map((stepState, index) => {
    const actionNodeState = stepState?.getActionNodeState?.();
    const node = actionNodeState?.getNode?.();
    const stepStates = Array.isArray(actionNodeState?.getStepStates?.())
      ? actionNodeState.getStepStates()
      : [];
    const stepId = ensureStepStateRuntimeId(stepState);
    const actionNodeStateId = ensureActionNodeStateRuntimeId(actionNodeState);
    return {
      index,
      nodeId: text(node?.workflowNodeId),
      nodeName: text(node?.getName?.()),
      nodeType: Number(node?.getNodeType?.()),
      actionNodeStateId,
      stepId,
      stepIndex: stepStates.indexOf(stepState),
    };
  });
}

function describeActionStepState(stepState = null) {
  const actionNodeState = stepState?.getActionNodeState?.() || null;
  const node = actionNodeState?.getNode?.() || null;
  const stepStates = Array.isArray(actionNodeState?.getStepStates?.())
    ? actionNodeState.getStepStates()
    : [];
  return {
    nodeId: text(node?.workflowNodeId),
    nodeName: text(node?.getName?.()),
    nodeType: Number(node?.getNodeType?.()),
    actionNodeStateId: ensureActionNodeStateRuntimeId(actionNodeState),
    stepId: ensureStepStateRuntimeId(stepState),
    stepIndex: stepStates.indexOf(stepState),
  };
}

function requireCurrentStepState(record, stepId) {
  const matched = snapshotCurrentSteps(record.bizinst).find(
    (stepState) => ensureStepStateRuntimeId(stepState) === stepId,
  );
  if (!matched) {
    throw new Error(`workflow pending step not found: ${record.instanceId}/${stepId}`);
  }
  return matched;
}

function requireWorkflowInstanceRecord(instanceId) {
  const record = getWorkflowInstanceRecord({ instanceId });
  if (!record) throw new Error(`workflow instance not found: ${instanceId}`);
  return record;
}

function isRuntimeActionNodeState(nodeState = null) {
  return Array.isArray(nodeState?.getStepStates?.());
}

function isRuntimeStateNodeState(nodeState = null) {
  return isFunction(nodeState?.getNode?.()?.getStateType);
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

export function resolveWorkflowUpstreamActionSteps({ instanceId, stepId }) {
  const record = requireWorkflowInstanceRecord(instanceId);
  const currentActionNodeState = requireCurrentStepState(record, stepId).getActionNodeState();
  const upstreamActionNodeStates =
    resolveUpstreamActionNodeStatesFromRuntime(currentActionNodeState);
  return upstreamActionNodeStates.flatMap((actionNodeState) => {
    const stepStates = Array.isArray(actionNodeState?.getStepStates?.())
      ? actionNodeState.getStepStates()
      : [];
    return stepStates.map((stepState) => describeActionStepState(stepState));
  });
}

export function startWorkflowInstanceById({
  instanceId = "",
  semantic = {},
  options = {},
  meta = {},
} = {}) {
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
  const id = text(instanceId);
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

export function advanceWorkflowInstanceById({ instanceId, action }) {
  const record = requireWorkflowInstanceRecord(instanceId);
  const stepState = requireCurrentStepState(record, action.stepId);
  const runtimeAction = createActionByType(action.type);
  record.controlCenter.execAction(runtimeAction, record.bizinst, stepState, record.treeRecord);
  record.transitions += 1;
  return getWorkflowInstanceSnapshot({ instanceId: record.instanceId });
}

export function releaseWorkflowInstance({ instanceId = "" } = {}) {
  const id = text(instanceId);
  if (!id) return false;
  return WORKFLOW_INSTANCE_STORE.delete(id);
}

export default {
  startWorkflowInstance,
  startWorkflowInstanceById,
  getWorkflowInstanceSnapshot,
  resolveWorkflowUpstreamActionSteps,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance,
};
