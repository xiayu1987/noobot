/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const Business = require("../engine/bizinst/business");
const BizinstTreeControlCenter = require("../engine/bizinstcontrolcenter/bizinst-tree-control-center");
const SubmitAction = require("../engine/bizinst/action/submit-action");
const AuditAction = require("../engine/bizinst/action/audit-action");
const BackAction = require("../engine/bizinst/action/back-action");
const StopAction = require("../engine/bizinst/action/stop-action");
const { compileWorkflowSemantic } = require("./compiler");

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

function startWorkflowInstance({ model = null } = {}) {
  const business = new Business();
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

function advanceWorkflowInstance({
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

function executeWorkflowSemantic({ semantic = {}, options = {} } = {}) {
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

module.exports = {
  startWorkflowInstance,
  advanceWorkflowInstance,
  executeWorkflowSemantic,
};
