/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IFlowto from './flowto/interfaces/flowto.js';
import INodeLineRLAT from './flowto/interfaces/node-line-rlat.js';
import INode from './node/interfaces/node.js';
import IStateNode from './node/interfaces/state-node.js';

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

export default  ModelUtility;
