/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Business from '../src/engine/bizinst/business.js';
import BackAction from '../src/engine/bizinst/action/back-action.js';
import StopAction from '../src/engine/bizinst/action/stop-action.js';
import SubmitAction from '../src/engine/bizinst/action/submit-action.js';
import NextAddStepAction from '../src/engine/bizinst/action/next-add-step-action.js';
import BizinstTreeControlCenter from '../src/engine/bizinstcontrolcenter/bizinst-tree-control-center.js';
import CantFlowException from '../src/engine/exception/cant-flow-exception.js';
import FlowPolicyException from '../src/engine/exception/flow-policy-exception.js';
import ECurrentStateSourceType from '../src/engine/bizinst/state/currentstate/enums/current-state-source-type.js';
import EModelStateType from '../src/engine/bizinst/state/modelstate/enums/model-state-type.js';
import ENodeType from '../src/design/model/node/enums/node-type.js';
import EFlowDirection from '../src/engine/bizinst/enums/flow-direction.js';
import EActionNodeStateProcessHandleWay from '../src/engine/bizinst/state/proc/fschange/enums/action-node-state-process-handle-way.js';
import ECompositeNodeStateProcessHandleWay from '../src/engine/bizinst/state/proc/fschange/enums/composite-node-state-process-handle-way.js';
import EStateNodeStateProcessHandleWay from '../src/engine/bizinst/state/proc/fschange/enums/state-node-state-process-handle-way.js';
import EStopReason from '../src/engine/bizinstcontrolcenter/enums/stop-reason.js';
import {
  buildSimpleModel,
  buildActionModel,
  buildBranchingActionModel,
  buildTwoActionModel,
  buildThreeActionModel,
  buildParallelActionModel,
  buildParentChildCompositeModel,
} from './helpers/model-builders.js';

test('startBizinst: simple model can start successfully', () => {
  const business = new Business();
  const model = buildSimpleModel();
  const controlCenter = new BizinstTreeControlCenter();

  const result = controlCenter.startBizinst(business, model);

  assert.ok(result);
  assert.ok(result.getBizinst());
  assert.ok(result.getActionRecord());
  assert.ok(result.getBizinstTreeRecord());
});

test('action flow: submit moves from action step to end state', () => {
  const business = new Business();
  const model = buildActionModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();

  const currentSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(currentSteps.length, 1);

  const submitAction = new SubmitAction();
  const actionRecord = controlCenter.execAction(submitAction, bizinst, currentSteps[0], treeRecord);
  assert.ok(actionRecord);

  const afterSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(afterSteps.length, 0);
  assert.equal(treeRecord.getActionRecords().length, 2);
});

test('startBizinst: model without flow throws CantFlowException', () => {
  const business = new Business();
  const model = buildSimpleModel();
  model.setFlowtos([]);
  model.setNodeLineRLATs([]);
  const controlCenter = new BizinstTreeControlCenter();

  assert.throws(() => {
    controlCenter.startBizinst(business, model);
  }, (err) => err instanceof CantFlowException);
});

test('action flow: back action returns to pre path and clears current step', () => {
  const business = new Business();
  const model = buildActionModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();
  const currentSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(currentSteps.length, 1);

  const backAction = new BackAction();
  const actionRecord = controlCenter.execAction(backAction, bizinst, currentSteps[0], treeRecord);
  assert.ok(actionRecord);

  const afterSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(afterSteps.length, 0);
});

test('action flow: stop action updates current-state source info', () => {
  const business = new Business();
  const model = buildActionModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();
  const currentStep = bizinst.getState().getCurrentState().getCurrentStepStates()[0];
  assert.ok(currentStep);

  const stopAction = new StopAction();
  const actionRecord = controlCenter.execAction(stopAction, bizinst, currentStep, treeRecord);
  assert.ok(actionRecord);

  const currentState = bizinst.getState().getCurrentState();
  const sourceInfo = currentState.getSourceInfo();
  assert.equal(currentState.getCurrentStateSourceType(), ECurrentStateSourceType.currentBizinst);
  assert.equal(sourceInfo.getModelStateType(), EModelStateType.ActionNodeState);
  assert.equal(sourceInfo.getModelState(), currentStep);
});

test('model-change action: next-add-step appends a new step and replaces current step', () => {
  const business = new Business();
  const model = buildActionModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();
  const oldCurrentStep = bizinst.getState().getCurrentState().getCurrentStepStates()[0];
  const actionNodeState = oldCurrentStep.getActionNodeState();
  const beforeStepCount = actionNodeState.getStepStates().length;

  const nextAddStepAction = new NextAddStepAction();
  const actionRecord = controlCenter.execAction(nextAddStepAction, bizinst, oldCurrentStep, treeRecord);
  assert.ok(actionRecord);

  const afterStepCount = actionNodeState.getStepStates().length;
  assert.equal(afterStepCount, beforeStepCount + 1);

  const currentSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(currentSteps.length, 1);
  assert.notEqual(currentSteps[0], oldCurrentStep);
});

test('branching action model: submit throws FlowPolicyException on multiple valid flowtos', () => {
  const business = new Business();
  const model = buildBranchingActionModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();
  const currentStep = bizinst.getState().getCurrentState().getCurrentStepStates()[0];
  assert.ok(currentStep);

  const submitAction = new SubmitAction();
  assert.throws(() => {
    controlCenter.execAction(submitAction, bizinst, currentStep, treeRecord);
  }, (err) => err instanceof FlowPolicyException);
});

test('complex flow: two-action chain supports submit/back/submit and reaches end', () => {
  const business = new Business();
  const model = buildTwoActionModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();

  // 启动后在审核A
  let currentStep = bizinst.getState().getCurrentState().getCurrentStepStates()[0];
  assert.equal(currentStep.getActionNodeState().getNode().getName(), '审核A');

  // 提交到审核B
  controlCenter.execAction(new SubmitAction(), bizinst, currentStep, treeRecord);
  currentStep = bizinst.getState().getCurrentState().getCurrentStepStates()[0];
  assert.equal(currentStep.getActionNodeState().getNode().getName(), '审核B');

  // 从审核B退回到审核A
  controlCenter.execAction(new BackAction(), bizinst, currentStep, treeRecord);
  currentStep = bizinst.getState().getCurrentState().getCurrentStepStates()[0];
  assert.equal(currentStep.getActionNodeState().getNode().getName(), '审核A');

  // 再次提交到审核B
  controlCenter.execAction(new SubmitAction(), bizinst, currentStep, treeRecord);
  currentStep = bizinst.getState().getCurrentState().getCurrentStepStates()[0];
  assert.equal(currentStep.getActionNodeState().getNode().getName(), '审核B');

  // 最后提交到结束节点
  controlCenter.execAction(new SubmitAction(), bizinst, currentStep, treeRecord);
  const finalSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(finalSteps.length, 0);
  assert.ok(treeRecord.getActionRecords().length >= 5);
});

test('complex flow: add-step in first action then submit to second action and stop', () => {
  const business = new Business();
  const model = buildTwoActionModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();

  // 初始在审核A
  const stepA1 = bizinst.getState().getCurrentState().getCurrentStepStates()[0];
  assert.equal(stepA1.getActionNodeState().getNode().getName(), '审核A');

  // 在审核A后加步骤，当前步骤应被替换
  controlCenter.execAction(new NextAddStepAction(), bizinst, stepA1, treeRecord);
  const currentAfterAdd = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(currentAfterAdd.length, 1);
  assert.notEqual(currentAfterAdd[0], stepA1);
  assert.equal(currentAfterAdd[0].getActionNodeState().getStepStates().length, 2);

  // 提交后到审核B
  controlCenter.execAction(new SubmitAction(), bizinst, currentAfterAdd[0], treeRecord);
  const stepB = bizinst.getState().getCurrentState().getCurrentStepStates()[0];
  assert.equal(stepB.getActionNodeState().getNode().getName(), '审核B');

  // 在审核B终止，检查sourceInfo
  controlCenter.execAction(new StopAction(), bizinst, stepB, treeRecord);
  const currentState = bizinst.getState().getCurrentState();
  const sourceInfo = currentState.getSourceInfo();
  assert.equal(currentState.getCurrentStateSourceType(), ECurrentStateSourceType.currentBizinst);
  assert.equal(sourceInfo.getModelStateType(), EModelStateType.ActionNodeState);
  assert.equal(sourceInfo.getModelState(), stepB);
  assert.ok(treeRecord.getActionRecords().length >= 4);
});

test('very complex flow: three-action chain with add-step and back cycles reaches end', () => {
  const business = new Business();
  const model = buildThreeActionModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();

  const getOnlyStep = () => {
    const steps = bizinst.getState().getCurrentState().getCurrentStepStates();
    assert.equal(steps.length, 1);
    return steps[0];
  };

  // 初始在A的第一个步骤
  const stepA0 = getOnlyStep();
  assert.equal(stepA0.getActionNodeState().getNode().getName(), '审核A');

  // A后加步骤 -> 当前为A新增步骤
  controlCenter.execAction(new NextAddStepAction(), bizinst, stepA0, treeRecord);
  const stepA1 = getOnlyStep();
  assert.equal(stepA1.getActionNodeState().getNode().getName(), '审核A');
  assert.notEqual(stepA1, stepA0);

  // 从A新增步骤退回到A原步骤
  controlCenter.execAction(new BackAction(), bizinst, stepA1, treeRecord);
  const stepA0Again = getOnlyStep();
  assert.equal(stepA0Again, stepA0);

  // 提交A原步骤 -> 到A新增步骤
  controlCenter.execAction(new SubmitAction(), bizinst, stepA0Again, treeRecord);
  const stepA1Again = getOnlyStep();
  assert.equal(stepA1Again, stepA1);

  // 再提交A新增步骤 -> 到B
  controlCenter.execAction(new SubmitAction(), bizinst, stepA1Again, treeRecord);
  const stepB0 = getOnlyStep();
  assert.equal(stepB0.getActionNodeState().getNode().getName(), '审核B');

  // B后加步骤
  controlCenter.execAction(new NextAddStepAction(), bizinst, stepB0, treeRecord);
  const stepB1 = getOnlyStep();
  assert.equal(stepB1.getActionNodeState().getNode().getName(), '审核B');
  assert.notEqual(stepB1, stepB0);

  // 退回到B原步骤，再提交回B新增步骤
  controlCenter.execAction(new BackAction(), bizinst, stepB1, treeRecord);
  const stepB0Again = getOnlyStep();
  assert.equal(stepB0Again, stepB0);
  controlCenter.execAction(new SubmitAction(), bizinst, stepB0Again, treeRecord);
  const stepB1Again = getOnlyStep();
  assert.equal(stepB1Again, stepB1);

  // 提交到C
  controlCenter.execAction(new SubmitAction(), bizinst, stepB1Again, treeRecord);
  const stepC0 = getOnlyStep();
  assert.equal(stepC0.getActionNodeState().getNode().getName(), '审核C');

  // 从C退回到B新增步骤
  controlCenter.execAction(new BackAction(), bizinst, stepC0, treeRecord);
  const stepB1FromC = getOnlyStep();
  assert.equal(stepB1FromC, stepB1);

  // 再次提交到C，再提交到结束
  controlCenter.execAction(new SubmitAction(), bizinst, stepB1FromC, treeRecord);
  const stepC0Again = getOnlyStep();
  assert.equal(stepC0Again.getActionNodeState().getNode().getName(), '审核C');
  controlCenter.execAction(new SubmitAction(), bizinst, stepC0Again, treeRecord);

  const finalSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(finalSteps.length, 0);
  assert.ok(treeRecord.getActionRecords().length >= 12);
});

test('parallel flow: split into two current steps and end after both submitted', () => {
  const business = new Business();
  const model = buildParallelActionModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();

  const startedSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(startedSteps.length, 2);
  const startedNames = startedSteps
    .map((s) => s.getActionNodeState().getNode().getName())
    .sort();
  assert.deepEqual(startedNames, ['并发审核A', '并发审核B']);

  controlCenter.execAction(new SubmitAction(), bizinst, startedSteps[0], treeRecord);
  const afterFirstSubmit = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(afterFirstSubmit.length, 1);

  controlCenter.execAction(new SubmitAction(), bizinst, afterFirstSubmit[0], treeRecord);
  const finalSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(finalSteps.length, 0);

  const sourceInfo = bizinst.getState().getCurrentState().getSourceInfo();
  assert.equal(sourceInfo.getModelStateType(), EModelStateType.StateNodeState);
  assert.equal(sourceInfo.getModelState().getNode().getName(), '并发结束节点');
});

test('composite flow: parent starts child bizinst and child sub-flow reaches its end state', () => {
  const business = new Business();
  const model = buildParentChildCompositeModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();

  assert.equal(bizinst.getChildBizinsts().length, 1);
  const childBizinst = bizinst.getChildBizinsts()[0];
  assert.equal(childBizinst.getParentBizinst(), bizinst);

  const childCurrentSteps = childBizinst.getState().getCurrentState().getCurrentStepStates();
  assert.equal(childCurrentSteps.length, 0);

  const childSourceInfo = childBizinst.getState().getCurrentState().getSourceInfo();
  assert.ok(childSourceInfo);
  assert.equal(childSourceInfo.getModelStateType(), EModelStateType.StateNodeState);
  assert.equal(childSourceInfo.getModelState().getNode().getName(), '子流程开始');

  const childStateNames = childBizinst
    .getState()
    .getBizinstModel()
    .getStateNodeStates()
    .map((s) => s.getNode().getName());
  assert.ok(childStateNames.includes('子流程开始'));
  assert.ok(childStateNames.includes('子流程结束'));

  const actionRecords = treeRecord.getActionRecords();
  assert.equal(actionRecords.length, 1);
  assert.equal(actionRecords[0].getProcessRecords().length, 2);
});

test('node type: provides readable name and description', () => {
  assert.equal(ENodeType.getName(ENodeType.StateNode), 'StateNode');
  assert.equal(ENodeType.getName(ENodeType.CompositeNode), 'CompositeNode');
  assert.equal(ENodeType.getName(ENodeType.ActionNode), 'ActionNode');

  assert.ok(ENodeType.getDescription(ENodeType.StateNode)?.includes('状态节点'));
  assert.ok(ENodeType.getDescription(ENodeType.CompositeNode)?.includes('复合节点'));
  assert.ok(ENodeType.getDescription(ENodeType.ActionNode)?.includes('动作节点'));
});

test('other enums: provide readable name and description', () => {
  assert.equal(EFlowDirection.getName(EFlowDirection.Forward), 'Forward');
  assert.ok(EFlowDirection.getDescription(EFlowDirection.Backward)?.includes('反向'));

  assert.equal(ECurrentStateSourceType.getName(ECurrentStateSourceType.currentBizinst), 'currentBizinst');
  assert.ok(ECurrentStateSourceType.getDescription(ECurrentStateSourceType.childBizinst)?.includes('子实例'));

  assert.equal(EModelStateType.getName(EModelStateType.StepState), 'StepState');
  assert.ok(EModelStateType.getDescription(EModelStateType.FlowtoState)?.includes('流转连线'));

  assert.equal(EActionNodeStateProcessHandleWay.getName(EActionNodeStateProcessHandleWay.Arrive), 'Arrive');
  assert.ok(EActionNodeStateProcessHandleWay.getDescription(EActionNodeStateProcessHandleWay.Stop)?.includes('终止'));

  assert.equal(
    ECompositeNodeStateProcessHandleWay.getName(ECompositeNodeStateProcessHandleWay.noticeParentBizinst),
    'noticeParentBizinst',
  );
  assert.ok(
    ECompositeNodeStateProcessHandleWay
      .getDescription(ECompositeNodeStateProcessHandleWay.startChildBizinst)
      ?.includes('启动子实例'),
  );

  assert.equal(EStateNodeStateProcessHandleWay.getName(EStateNodeStateProcessHandleWay.forwardStateChange), 'forwardStateChange');
  assert.ok(EStateNodeStateProcessHandleWay.getDescription(EStateNodeStateProcessHandleWay.backwardStateChange)?.includes('反向'));

  assert.equal(EStopReason.getName(EStopReason.actionStop), 'actionStop');
  assert.ok(EStopReason.getDescription(EStopReason.childStop)?.includes('子流程'));
});
