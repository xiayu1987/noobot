/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ModelUtility from "../../../../design/model/model-utility.js";

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
    return ModelUtility.getNodeStartFlowtos(this.getNode());
  }

  getNodeEndFlowtos() {
    return ModelUtility.getNodeEndFlowtos(this.getNode());
  }

  getToThisPathState() {
    const pathStates = this.getNodeState().getBizinstModel().getPathStates() || [];
    for (const pathState of pathStates) {
      if (pathState.getEndNodeState() === this.getNodeState()) return pathState;
    }
    return null;
  }
}

export default NodeStateBoxBase;
