/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const Model = require('../src/design/model/model');
const Flowto = require('../src/design/model/flowto/flowto');
const NodeLineRLAT = require('../src/design/model/flowto/node-line-rlat');
const ActionNode = require('../src/design/model/node/action-node');
const StateNode = require('../src/design/model/node/state-node');
const ENodeType = require('../src/design/model/node/enums/node-type');
const Business = require('../src/engine/bizinst/business');
const SubmitAction = require('../src/engine/bizinst/action/submit-action');
const BizinstTreeControlCenter = require('../src/engine/bizinstcontrolcenter/bizinst-tree-control-center');

function linkFlow(flowName, fromNode, toNode) {
  const flow = new Flowto();
  flow.setName(flowName);
  flow.setStartNode(fromNode);
  flow.setEndNode(toNode);

  const fromRLAT = new NodeLineRLAT();
  fromRLAT.setNode(fromNode);
  fromRLAT.setFlowto(flow);
  fromRLAT.setRLATType(1);

  const toRLAT = new NodeLineRLAT();
  toRLAT.setNode(toNode);
  toRLAT.setFlowto(flow);
  toRLAT.setRLATType(0);

  return { flow, fromRLAT, toRLAT };
}

function createStateNode(name, stateType, model) {
  const node = new StateNode();
  node.setName(name);
  node.setNodeType(ENodeType.StateNode);
  node.setStateType(stateType);
  node.setModel(model);
  return node;
}

function buildParallelModel() {
  const model = new Model();
  const startParallelNode = createStateNode('并发开始节点', 2, model);
  const endParallelNode = createStateNode('并发结束节点', 3, model);

  const actionA = new ActionNode();
  actionA.setName('并发审核A');
  actionA.setNodeType(ENodeType.ActionNode);
  actionA.setModel(model);

  const actionB = new ActionNode();
  actionB.setName('并发审核B');
  actionB.setNodeType(ENodeType.ActionNode);
  actionB.setModel(model);

  const s2a = linkFlow('并发开始到A', startParallelNode, actionA);
  const s2b = linkFlow('并发开始到B', startParallelNode, actionB);
  const a2e = linkFlow('A到并发结束', actionA, endParallelNode);
  const b2e = linkFlow('B到并发结束', actionB, endParallelNode);

  model.setNodes([startParallelNode, actionA, actionB, endParallelNode]);
  model.setFlowtos([s2a.flow, s2b.flow, a2e.flow, b2e.flow]);
  model.setNodeLineRLATs([
    s2a.fromRLAT,
    s2a.toRLAT,
    s2b.fromRLAT,
    s2b.toRLAT,
    a2e.fromRLAT,
    a2e.toRLAT,
    b2e.fromRLAT,
    b2e.toRLAT,
  ]);
  return model;
}

function main() {
  const business = new Business();
  const model = buildParallelModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();

  let currentSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  console.log('启动后当前步骤数:', currentSteps.length);
  console.log(
    '当前步骤节点:',
    currentSteps.map((s) => s.getActionNodeState().getNode().getName()).join(', '),
  );

  controlCenter.execAction(new SubmitAction(), bizinst, currentSteps[0], treeRecord);
  currentSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  console.log('提交一个分支后当前步骤数:', currentSteps.length);

  controlCenter.execAction(new SubmitAction(), bizinst, currentSteps[0], treeRecord);
  currentSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  console.log('提交全部分支后当前步骤数:', currentSteps.length);

  const sourceNodeName =
    bizinst.getState().getCurrentState().getSourceInfo()?.getModelState()?.getNode()?.getName?.();
  console.log('当前状态来源节点:', sourceNodeName);
  console.log('动作记录数:', treeRecord.getActionRecords().length);
}

main();
