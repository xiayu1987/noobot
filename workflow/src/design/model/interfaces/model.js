/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../interfaces/can-persistence');
var IFlowto = require('../flowto/interfaces/flowto');
var INodeLineRLAT = require('../flowto/interfaces/node-line-rlat');
var INode = require('../node/interfaces/node');

class IModel {
  getNodes() {}
  setNodes(nodes) {}
  getFlowtos() {}
  setFlowtos(flowtos) {}
  getNodeLineRLATs() {}
  setNodeLineRLATs(nodeLineRLAT) {}
}

module.exports = IModel;
