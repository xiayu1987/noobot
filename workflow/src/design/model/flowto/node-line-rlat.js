/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../can-persistence-base');
var INode = require('../node/interfaces/node');

class NodeLineRLAT extends CanPersistenceBase {
  constructor() {
    super();
    this.node = null;
    this.flowto = null;
    this.rLATType = null;
  }
  getNode() {
    return this.node;
  }
  setNode(node) {
    this.node = node;
  }
  getFlowto() {
    return this.flowto;
  }
  setFlowto(flowto) {
    this.flowto = flowto;
  }
  getRLATType() {
    return this.rLATType;
  }
  setRLATType(rLATType) {
    this.rLATType = rLATType;
  }
}

module.exports = NodeLineRLAT;
