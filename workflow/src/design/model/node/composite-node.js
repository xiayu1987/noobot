/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IFlowto = require('../flowto/interfaces/flowto');
var INodeLineRLAT = require('../flowto/interfaces/node-line-rlat');
var NodeBase = require('./node-base');

class CompositeNode extends NodeBase {
  constructor() {
    super();
    this.nodes = null;
    this.flowtos = null;
    this.nodeLineRLAT = null;
  }
  getNodes() {
    return this.nodes;
  }
  setNodes(nodes) {
    this.nodes = nodes;
  }
  getFlowtos() {
    return this.flowtos;
  }
  setFlowtos(flowtos) {
    this.flowtos = flowtos;
  }
  getNodeLineRLATs() {
    return this.nodeLineRLAT;
  }
  setNodeLineRLATs(nodeLineRLAT) {
    this.nodeLineRLAT = nodeLineRLAT;
  }
}

module.exports = CompositeNode;
