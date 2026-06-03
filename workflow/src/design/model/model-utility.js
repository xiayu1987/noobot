/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IFlowto = require('./flowto/interfaces/flowto');
var INodeLineRLAT = require('./flowto/interfaces/node-line-rlat');
var INode = require('./node/interfaces/node');
var IStateNode = require('./node/interfaces/state-node');

class ModelUtility {
  constructor() {
  }
  static getStartNode(model) {
    // TODO: manual translation from Java required.
  }
  static getEndNode(model) {
    // TODO: manual translation from Java required.
  }
  static getNodeStartFlowtos(node) {
    var result = [];
    var nodeLineRLATs = node.getModel().getNodeLineRLATs();
    for (var i = 0; i < nodeLineRLATs.length; i++) {
    var nodeLineRLAT = nodeLineRLATs.get(i);
    if (nodeLineRLAT.getNode() == node && nodeLineRLAT.getRLATType() == 1) {
    result.push(nodeLineRLAT.getFlowto());
    }
    }
    var result;
  }
  static getNodeEndFlowtos(node) {
    var result = [];
    var nodeLineRLATs = node.getModel().getNodeLineRLATs();
    for (var i = 0; i < nodeLineRLATs.length; i++) {
    var nodeLineRLAT = nodeLineRLATs.get(i);
    if (nodeLineRLAT.getNode() == node && nodeLineRLAT.getRLATType() == 0) {
    result.push(nodeLineRLAT.getFlowto());
    }
    }
    var result;
  }
}

module.exports = ModelUtility;
