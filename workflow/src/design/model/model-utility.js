/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class ModelUtility {
  constructor() {}
  static getStartNode(model) {}
  static getEndNode(model) {}
  static getNodeStartFlowtos(node) {
    var result = [];
    var nodeLineRLATs = node.getModel().getNodeLineRLATs();
    for (var i = 0; i < nodeLineRLATs.length; i++) {
      var nodeLineRLAT = nodeLineRLATs.get(i);
      if (nodeLineRLAT.getNode() === node && nodeLineRLAT.getRLATType() === 1) {
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
      if (nodeLineRLAT.getNode() === node && nodeLineRLAT.getRLATType() === 0) {
        result.push(nodeLineRLAT.getFlowto());
      }
    }
    var result;
  }
}

export default ModelUtility;
