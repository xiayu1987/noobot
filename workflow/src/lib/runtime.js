/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import Business from "../engine/bizinst/business.js";
import BizinstTreeControlCenter from "../engine/bizinstcontrolcenter/bizinst-tree-control-center.js";
import ActionNodeState from "../engine/bizinst/state/modelstate/action-node-state.js";
import StateNodeState from "../engine/bizinst/state/modelstate/state-node-state.js";
import SubmitAction from "../engine/bizinst/action/submit-action.js";
import AuditAction from "../engine/bizinst/action/audit-action.js";
import BackAction from "../engine/bizinst/action/back-action.js";
import StopAction from "../engine/bizinst/action/stop-action.js";
import { compileWorkflowSemantic } from "./compiler.js";
import EStateType from "../design/model/node/enums/state-type.js";
import { text } from "@noobot/shared/value";
const WORKFLOW_INSTANCE_STORE = new Map();
let WORKFLOW_RUNTIME_ID_COUNTER = 0;

const RUNTIME_ACTION_FACTORIES = Object.freeze({
  submit: () => new SubmitAction(),
  audit: () => new AuditAction(),
  back: () => new BackAction(),
  stop: () => new StopAction(),
});

export const WORKFLOW_ACTION_TYPE = Object.freeze(
  Object.fromEntries(
    Object.keys(RUNTIME_ACTION_FACTORIES).map((type) => [type.toUpperCase(), type]),
  ),
);

export function isWorkflowActionType(type) {
  return Object.hasOwn(RUNTIME_ACTION_FACTORIES, type);
}

function createActionByType(type) {
  if (!isWorkflowActionType(type)) {
    throw new Error(`workflow action type invalid: ${type}`);
  }
  return RUNTIME_ACTION_FACTORIES[type]();
}

function snapshotCurrentSteps(bizinst) {
  return bizinst.getState().getCurrentState().getCurrentStepStates();
}

function summarizeActionRecords(treeRecord) {
  return treeRecord.getActionRecords().map((record) => {
    const action = record.getAction();
    return {
      actionName: text(action.getName()),
      actionKind: text(action.getActionKind()),
    };
  });
}

function nextWorkflowRuntimeId(prefix) {
  WORKFLOW_RUNTIME_ID_COUNTER += 1;
  return `${prefix}_${Date.now()}_${WORKFLOW_RUNTIME_ID_COUNTER}`;
}

function readWorkflowRuntime(state) {
  const dataContext = state.getDataContext();
  return dataContext === null ? null : dataContext.workflowRuntime;
}

function ensureActionNodeStateRuntimeId(actionNodeState) {
  const existing = readWorkflowRuntime(actionNodeState);
  if (existing) return existing.actionNodeStateId;
  const actionNodeStateId = nextWorkflowRuntimeId("wf_action_state");
  actionNodeState.setDataContext({ workflowRuntime: { actionNodeStateId } });
  return actionNodeStateId;
}

function ensureStepStateRuntimeId(stepState) {
  const existing = readWorkflowRuntime(stepState);
  if (existing) return existing.stepId;
  const actionNodeStateId = ensureActionNodeStateRuntimeId(stepState.getActionNodeState());
  const stepId = nextWorkflowRuntimeId("wf_step");
  stepState.setDataContext({ workflowRuntime: { stepId, actionNodeStateId } });
  return stepId;
}

export function startWorkflowInstance({ model }) {
  const business = new Business();
  const controlCenter = new BizinstTreeControlCenter();
  const startResult = controlCenter.startBizinst(business, model);
  return {
    business,
    controlCenter,
    startResult,
    bizinst: startResult.getBizinst(),
    treeRecord: startResult.getBizinstTreeRecord(),
  };
}

function requireInstanceId(input) {
  const normalized = text(input);
  if (!normalized) throw new Error("workflow instanceId is required");
  return normalized;
}

function describeActionStepState(stepState) {
  const actionNodeState = stepState.getActionNodeState();
  const node = actionNodeState.getNode();
  return {
    nodeId: text(node.workflowNodeId),
    nodeName: text(node.getName()),
    actionNodeStateId: ensureActionNodeStateRuntimeId(actionNodeState),
    stepId: ensureStepStateRuntimeId(stepState),
    stepIndex: actionNodeState.getStepStates().indexOf(stepState),
  };
}

function describePendingSteps(bizinst) {
  return snapshotCurrentSteps(bizinst).map((stepState, index) => ({
    index,
    ...describeActionStepState(stepState),
  }));
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
  const record = WORKFLOW_INSTANCE_STORE.get(requireInstanceId(instanceId));
  if (!record) throw new Error(`workflow instance not found: ${instanceId}`);
  return record;
}

function collectIncomingStartNodeStates(nodeState) {
  const model = nodeState.getBizinstModel();
  const node = nodeState.getNode();
  const equivalentEndNodeStates = new Set([nodeState]);
  if (nodeState instanceof StateNodeState && node.getStateType() === EStateType.Merge) {
    for (const stateNodeState of model.getStateNodeStates()) {
      if (stateNodeState.getNode() === node) equivalentEndNodeStates.add(stateNodeState);
    }
  }
  return model
    .getPathStates()
    .filter((pathState) => equivalentEndNodeStates.has(pathState.getEndNodeState()))
    .map((pathState) => pathState.getStartNodeState());
}

function resolveUpstreamActionNodeStatesFromRuntime(nodeState) {
  const collected = new Set();
  const visited = new Set();

  function visit(currentNodeState) {
    if (visited.has(currentNodeState)) return;
    visited.add(currentNodeState);
    for (const startNodeState of collectIncomingStartNodeStates(currentNodeState)) {
      if (startNodeState instanceof ActionNodeState) {
        collected.add(startNodeState);
      } else if (startNodeState instanceof StateNodeState) {
        visit(startNodeState);
      }
    }
  }

  visit(nodeState);
  return [...collected];
}

export function resolveWorkflowUpstreamActionSteps({ instanceId, stepId }) {
  const record = requireWorkflowInstanceRecord(instanceId);
  const currentActionNodeState = requireCurrentStepState(record, stepId).getActionNodeState();
  return resolveUpstreamActionNodeStatesFromRuntime(currentActionNodeState).flatMap(
    (actionNodeState) =>
      actionNodeState.getStepStates().map((stepState) => describeActionStepState(stepState)),
  );
}

export function startWorkflowInstanceById({ instanceId, semantic }) {
  const id = requireInstanceId(instanceId);
  if (WORKFLOW_INSTANCE_STORE.has(id)) throw new Error(`workflow instance already exists: ${id}`);
  const started = startWorkflowInstance({ model: compileWorkflowSemantic(semantic) });
  WORKFLOW_INSTANCE_STORE.set(id, {
    instanceId: id,
    createdAt: new Date().toISOString(),
    controlCenter: started.controlCenter,
    bizinst: started.bizinst,
    treeRecord: started.treeRecord,
    transitions: 0,
  });
  return getWorkflowInstanceSnapshot({ instanceId: id });
}

export function getWorkflowInstanceSnapshot({ instanceId }) {
  const record = requireWorkflowInstanceRecord(instanceId);
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

export function releaseWorkflowInstance({ instanceId }) {
  WORKFLOW_INSTANCE_STORE.delete(requireWorkflowInstanceRecord(instanceId).instanceId);
}

export default {
  startWorkflowInstance,
  startWorkflowInstanceById,
  getWorkflowInstanceSnapshot,
  resolveWorkflowUpstreamActionSteps,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance,
};
