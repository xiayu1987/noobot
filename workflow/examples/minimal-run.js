/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import Model from '../src/design/model/model.js';
import Flowto from '../src/design/model/flowto/flowto.js';
import NodeLineRLAT from '../src/design/model/flowto/node-line-rlat.js';
import StateNode from '../src/design/model/node/state-node.js';
import ENodeType from '../src/design/model/node/enums/node-type.js';
import Business from '../src/engine/bizinst/business.js';
import BizinstTreeControlCenter from '../src/engine/bizinstcontrolcenter/bizinst-tree-control-center.js';

function buildSimpleModel() {
  const model = new Model();

  const startNode = new StateNode();
  startNode.setName('开始节点');
  startNode.setNodeType(ENodeType.StateNode);
  startNode.setStateType(0);
  startNode.setModel(model);

  const endNode = new StateNode();
  endNode.setName('结束节点');
  endNode.setNodeType(ENodeType.StateNode);
  endNode.setStateType(1);
  endNode.setModel(model);

  const flowto = new Flowto();
  flowto.setName('开始到结束');
  flowto.setStartNode(startNode);
  flowto.setEndNode(endNode);

  const startRLAT = new NodeLineRLAT();
  startRLAT.setNode(startNode);
  startRLAT.setFlowto(flowto);
  startRLAT.setRLATType(1);

  const endRLAT = new NodeLineRLAT();
  endRLAT.setNode(endNode);
  endRLAT.setFlowto(flowto);
  endRLAT.setRLATType(0);

  model.setNodes([startNode, endNode]);
  model.setFlowtos([flowto]);
  model.setNodeLineRLATs([startRLAT, endRLAT]);
  return model;
}

function main() {
  const business = new Business();
  const model = buildSimpleModel();
  const controlCenter = new BizinstTreeControlCenter();
  const result = controlCenter.startBizinst(business, model);

  console.log('startBizinst success:', !!result);
  console.log('bizinst exists:', !!result?.getBizinst?.());
  console.log('actionRecord exists:', !!result?.getActionRecord?.());
}

main();
