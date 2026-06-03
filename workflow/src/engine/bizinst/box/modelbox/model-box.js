/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IModel from '../../../../design/model/interfaces/model.js';
import INode from '../../../../design/model/node/interfaces/node.js';
import IStateNode from '../../../../design/model/node/interfaces/state-node.js';

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
      if (typeof node.getStateType === 'function') {
        const stateType = node.getStateType();
        if (stateType === 0 || stateType === 2) return node;
      }
    }
    return null;
  }
  getEndNode() {
    const nodes = this.getModel().getNodes() || [];
    for (const node of nodes) {
      if (typeof node.getStateType === 'function') {
        const stateType = node.getStateType();
        if (stateType === 1 || stateType === 3) return node;
      }
    }
    return null;
  }
}

export default  ModelBox;
