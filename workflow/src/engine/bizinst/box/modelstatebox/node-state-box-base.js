/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class NodeStateBoxBase {
  constructor() {
    this.nodeState = null;
  }

  setNodeState(nodeState) {
    this.nodeState = nodeState;
  }

  getNodeState() {
    return this.nodeState;
  }

  getNode() {
    return this.getNodeState().getNode();
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

  getToThisPathState() {
    const pathStates = this.getNodeState().getBizinstModel().getPathStates() || [];
    for (const pathState of pathStates) {
      if (pathState.getEndNodeState() === this.getNodeState()) return pathState;
    }
    return null;
  }
}

module.exports = NodeStateBoxBase;
