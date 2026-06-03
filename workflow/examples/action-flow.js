/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import Model from '../src/design/model/model.js';
import Flowto from '../src/design/model/flowto/flowto.js';
import NodeLineRLAT from '../src/design/model/flowto/node-line-rlat.js';
import ActionNode from '../src/design/model/node/action-node.js';
import StateNode from '../src/design/model/node/state-node.js';
import ENodeType from '../src/design/model/node/enums/node-type.js';
import Business from '../src/engine/bizinst/business.js';
import SubmitAction from '../src/engine/bizinst/action/submit-action.js';
import BizinstTreeControlCenter from '../src/engine/bizinstcontrolcenter/bizinst-tree-control-center.js';

function linkFlow(model, flowName, fromNode, toNode) {
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

function buildActionModel() {
  const model = new Model();

  const startNode = new StateNode();
  startNode.setName('开始节点');
  startNode.setNodeType(ENodeType.StateNode);
  startNode.setStateType(0);
  startNode.setModel(model);

  const actionNode = new ActionNode();
  actionNode.setName('审核节点');
  actionNode.setNodeType(ENodeType.ActionNode);
  actionNode.setModel(model);

  const endNode = new StateNode();
  endNode.setName('结束节点');
  endNode.setNodeType(ENodeType.StateNode);
  endNode.setStateType(1);
  endNode.setModel(model);

  const s2a = linkFlow(model, '开始到审核', startNode, actionNode);
  const a2e = linkFlow(model, '审核到结束', actionNode, endNode);

  model.setNodes([startNode, actionNode, endNode]);
  model.setFlowtos([s2a.flow, a2e.flow]);
  model.setNodeLineRLATs([s2a.fromRLAT, s2a.toRLAT, a2e.fromRLAT, a2e.toRLAT]);
  return model;
}

function main() {
  const business = new Business();
  const model = buildActionModel();
  const controlCenter = new BizinstTreeControlCenter();

  const startResult = controlCenter.startBizinst(business, model);
  const bizinst = startResult.getBizinst();
  const treeRecord = startResult.getBizinstTreeRecord();

  const currentSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  console.log('启动后当前步骤数:', currentSteps.length);

  if (!currentSteps.length) {
    throw new Error('没有可提交的步骤状态。');
  }

  const submitAction = new SubmitAction();
  controlCenter.execAction(submitAction, bizinst, currentSteps[0], treeRecord);

  const afterSteps = bizinst.getState().getCurrentState().getCurrentStepStates();
  console.log('提交后当前步骤数:', afterSteps.length);
  console.log('动作记录数:', treeRecord.getActionRecords().length);
}

main();
