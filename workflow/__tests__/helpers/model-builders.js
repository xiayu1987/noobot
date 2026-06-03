/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const Model = require('../../src/design/model/model');
const Flowto = require('../../src/design/model/flowto/flowto');
const NodeLineRLAT = require('../../src/design/model/flowto/node-line-rlat');
const ActionNode = require('../../src/design/model/node/action-node');
const CompositeNode = require('../../src/design/model/node/composite-node');
const StateNode = require('../../src/design/model/node/state-node');
const ENodeType = require('../../src/design/model/node/enums/node-type');

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

function buildSimpleModel() {
  const model = new Model();
  const startNode = createStateNode('开始节点', 0, model);
  const endNode = createStateNode('结束节点', 1, model);
  const flow = linkFlow('开始到结束', startNode, endNode);

  model.setNodes([startNode, endNode]);
  model.setFlowtos([flow.flow]);
  model.setNodeLineRLATs([flow.fromRLAT, flow.toRLAT]);
  return model;
}

function buildActionModel() {
  const model = new Model();
  const startNode = createStateNode('开始节点', 0, model);
  const endNode = createStateNode('结束节点', 1, model);

  const actionNode = new ActionNode();
  actionNode.setName('审核节点');
  actionNode.setNodeType(ENodeType.ActionNode);
  actionNode.setModel(model);

  const s2a = linkFlow('开始到审核', startNode, actionNode);
  const a2e = linkFlow('审核到结束', actionNode, endNode);

  model.setNodes([startNode, actionNode, endNode]);
  model.setFlowtos([s2a.flow, a2e.flow]);
  model.setNodeLineRLATs([s2a.fromRLAT, s2a.toRLAT, a2e.fromRLAT, a2e.toRLAT]);
  return model;
}

function buildBranchingActionModel() {
  const model = new Model();
  const startNode = createStateNode('开始节点', 0, model);

  const actionNode = new ActionNode();
  actionNode.setName('分支审核节点');
  actionNode.setNodeType(ENodeType.ActionNode);
  actionNode.setModel(model);

  const endNodeA = createStateNode('结束节点A', 1, model);
  const endNodeB = createStateNode('结束节点B', 1, model);

  const s2a = linkFlow('开始到分支审核', startNode, actionNode);
  const a2eA = linkFlow('分支到结束A', actionNode, endNodeA);
  const a2eB = linkFlow('分支到结束B', actionNode, endNodeB);

  model.setNodes([startNode, actionNode, endNodeA, endNodeB]);
  model.setFlowtos([s2a.flow, a2eA.flow, a2eB.flow]);
  model.setNodeLineRLATs([
    s2a.fromRLAT,
    s2a.toRLAT,
    a2eA.fromRLAT,
    a2eA.toRLAT,
    a2eB.fromRLAT,
    a2eB.toRLAT,
  ]);
  return model;
}

function buildTwoActionModel() {
  const model = new Model();
  const startNode = createStateNode('开始节点', 0, model);
  const actionNodeA = new ActionNode();
  actionNodeA.setName('审核A');
  actionNodeA.setNodeType(ENodeType.ActionNode);
  actionNodeA.setModel(model);

  const actionNodeB = new ActionNode();
  actionNodeB.setName('审核B');
  actionNodeB.setNodeType(ENodeType.ActionNode);
  actionNodeB.setModel(model);

  const endNode = createStateNode('结束节点', 1, model);

  const s2a = linkFlow('开始到审核A', startNode, actionNodeA);
  const a2b = linkFlow('审核A到审核B', actionNodeA, actionNodeB);
  const b2e = linkFlow('审核B到结束', actionNodeB, endNode);

  model.setNodes([startNode, actionNodeA, actionNodeB, endNode]);
  model.setFlowtos([s2a.flow, a2b.flow, b2e.flow]);
  model.setNodeLineRLATs([
    s2a.fromRLAT,
    s2a.toRLAT,
    a2b.fromRLAT,
    a2b.toRLAT,
    b2e.fromRLAT,
    b2e.toRLAT,
  ]);
  return model;
}

function buildThreeActionModel() {
  const model = new Model();
  const startNode = createStateNode('开始节点', 0, model);
  const endNode = createStateNode('结束节点', 1, model);

  const actionNodeA = new ActionNode();
  actionNodeA.setName('审核A');
  actionNodeA.setNodeType(ENodeType.ActionNode);
  actionNodeA.setModel(model);

  const actionNodeB = new ActionNode();
  actionNodeB.setName('审核B');
  actionNodeB.setNodeType(ENodeType.ActionNode);
  actionNodeB.setModel(model);

  const actionNodeC = new ActionNode();
  actionNodeC.setName('审核C');
  actionNodeC.setNodeType(ENodeType.ActionNode);
  actionNodeC.setModel(model);

  const s2a = linkFlow('开始到审核A', startNode, actionNodeA);
  const a2b = linkFlow('审核A到审核B', actionNodeA, actionNodeB);
  const b2c = linkFlow('审核B到审核C', actionNodeB, actionNodeC);
  const c2e = linkFlow('审核C到结束', actionNodeC, endNode);

  model.setNodes([startNode, actionNodeA, actionNodeB, actionNodeC, endNode]);
  model.setFlowtos([s2a.flow, a2b.flow, b2c.flow, c2e.flow]);
  model.setNodeLineRLATs([
    s2a.fromRLAT,
    s2a.toRLAT,
    a2b.fromRLAT,
    a2b.toRLAT,
    b2c.fromRLAT,
    b2c.toRLAT,
    c2e.fromRLAT,
    c2e.toRLAT,
  ]);
  return model;
}

function buildParallelActionModel() {
  const model = new Model();
  const startParallelNode = createStateNode('并发开始节点', 2, model);
  const endParallelNode = createStateNode('并发结束节点', 3, model);

  const actionNodeA = new ActionNode();
  actionNodeA.setName('并发审核A');
  actionNodeA.setNodeType(ENodeType.ActionNode);
  actionNodeA.setModel(model);

  const actionNodeB = new ActionNode();
  actionNodeB.setName('并发审核B');
  actionNodeB.setNodeType(ENodeType.ActionNode);
  actionNodeB.setModel(model);

  const s2a = linkFlow('并发开始到A', startParallelNode, actionNodeA);
  const s2b = linkFlow('并发开始到B', startParallelNode, actionNodeB);
  const a2e = linkFlow('A到并发结束', actionNodeA, endParallelNode);
  const b2e = linkFlow('B到并发结束', actionNodeB, endParallelNode);

  model.setNodes([startParallelNode, actionNodeA, actionNodeB, endParallelNode]);
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

function buildParentChildCompositeModel() {
  const model = new Model();
  const parentStartNode = createStateNode('主流程开始', 0, model);
  const parentEndNode = createStateNode('主流程结束', 1, model);

  const compositeNode = new CompositeNode();
  compositeNode.setName('子流程节点');
  compositeNode.setNodeType(ENodeType.CompositeNode);
  compositeNode.setModel(model);

  const p2c = linkFlow('主流程开始到子流程', parentStartNode, compositeNode);
  const c2e = linkFlow('子流程到主流程结束', compositeNode, parentEndNode);

  model.setNodes([parentStartNode, compositeNode, parentEndNode]);
  model.setFlowtos([p2c.flow, c2e.flow]);
  model.setNodeLineRLATs([p2c.fromRLAT, p2c.toRLAT, c2e.fromRLAT, c2e.toRLAT]);

  const childStartNode = new StateNode();
  childStartNode.setName('子流程开始');
  childStartNode.setNodeType(ENodeType.StateNode);
  childStartNode.setStateType(0);
  childStartNode.setModel(compositeNode);

  const childEndNode = new StateNode();
  childEndNode.setName('子流程结束');
  childEndNode.setNodeType(ENodeType.StateNode);
  childEndNode.setStateType(1);
  childEndNode.setModel(compositeNode);

  const childFlow = linkFlow('子流程开始到结束', childStartNode, childEndNode);
  compositeNode.setNodes([childStartNode, childEndNode]);
  compositeNode.setFlowtos([childFlow.flow]);
  compositeNode.setNodeLineRLATs([childFlow.fromRLAT, childFlow.toRLAT]);

  return model;
}

module.exports = {
  buildSimpleModel,
  buildActionModel,
  buildBranchingActionModel,
  buildTwoActionModel,
  buildThreeActionModel,
  buildParallelActionModel,
  buildParentChildCompositeModel,
};
