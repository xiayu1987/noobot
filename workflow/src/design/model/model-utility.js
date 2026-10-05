/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class ModelUtility {
  constructor() {}
  static getStartNode(model) {}
  static getEndNode(model) {}
  static getNodeFlowtosByRLATType(node, rLATType) {
    const result = [];
    const nodeLineRLATs = node?.getModel?.()?.getNodeLineRLATs?.() || [];
    for (const nodeLineRLAT of nodeLineRLATs) {
      if (nodeLineRLAT.getNode() === node && nodeLineRLAT.getRLATType() === rLATType) {
        result.push(nodeLineRLAT.getFlowto());
      }
    }
    return result;
  }
  static getNodeStartFlowtos(node) {
    return ModelUtility.getNodeFlowtosByRLATType(node, 1);
  }
  static getNodeEndFlowtos(node) {
    return ModelUtility.getNodeFlowtosByRLATType(node, 0);
  }
}

export default ModelUtility;
