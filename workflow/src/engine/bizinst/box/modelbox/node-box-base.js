/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ModelUtility from "../../../../design/model/model-utility.js";

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
    return ModelUtility.getNodeStartFlowtos(this.getNode());
  }

  getNodeEndFlowtos() {
    return ModelUtility.getNodeEndFlowtos(this.getNode());
  }

  createNodeState(modelState) {
    return null;
  }
}

export default NodeBoxBase;
