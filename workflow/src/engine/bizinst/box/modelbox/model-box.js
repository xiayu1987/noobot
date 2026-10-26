/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import EStateType from "../../../../design/model/node/enums/state-type.js";

class ModelBox {
  constructor() {
    this.model = null;
  }
  setModel(model) {
    this.model = model;
  }
  getModel() {
    return this.model;
  }
  getStartNode() {
    const nodes = this.getModel().getNodes() || [];
    for (const node of nodes) {
      if (typeof node.getStateType === "function") {
        const stateType = node.getStateType();
        if (stateType === EStateType.Start || stateType === EStateType.Branch) return node;
      }
    }
    return null;
  }
  getEndNode() {
    const nodes = this.getModel().getNodes() || [];
    for (const node of nodes) {
      if (typeof node.getStateType === "function") {
        const stateType = node.getStateType();
        if (stateType === EStateType.End || stateType === EStateType.Merge) return node;
      }
    }
    return null;
  }
}

export default ModelBox;
