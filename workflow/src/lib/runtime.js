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
    return {
      index,
      nodeName: String(node?.getName?.() || "").trim(),
      nodeType: Number(node?.getNodeType?.()),
    };
  });
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
  advanceWorkflowInstanceById,
  releaseWorkflowInstance,
};
