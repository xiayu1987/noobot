/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class NodeBoxBase {
  constructor() {
    this.node = null;
  }

  setNode(node) {
    this.node = node;
  }

  getNode() {
    return this.node;
  }

  getNodeStartFlowtos() {
    const result = [];
    const nodeLineRLATs = this.getNode()?.getModel?.()?.getNodeLineRLATs?.() || [];
    for (const nodeLineRLAT of nodeLineRLATs) {
      if (nodeLineRLAT.getNode() === this.getNode() && nodeLineRLAT.getRLATType() === 1) {
        result.push(nodeLineRLAT.getFlowto());
      }
    }
    return result;
  }

  getNodeEndFlowtos() {
    const result = [];
    const nodeLineRLATs = this.getNode()?.getModel?.()?.getNodeLineRLATs?.() || [];
    for (const nodeLineRLAT of nodeLineRLATs) {
      if (nodeLineRLAT.getNode() === this.getNode() && nodeLineRLAT.getRLATType() === 0) {
        result.push(nodeLineRLAT.getFlowto());
      }
    }
    return result;
  }

  createNodeState(modelState) {
    return null;
  }
}

export default  NodeBoxBase;
