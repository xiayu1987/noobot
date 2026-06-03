/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../can-persistence-base.js';
import IModel from '../interfaces/model.js';

class NodeBase extends CanPersistenceBase {
  constructor() {
    super();
    this.nodeType = null;
    this.model = null;
    this.name = null;
  }
  setModel(model) {
    this.model = model;
  }
  getModel() {
    return this.model;
  }
  setNodeType(nodeType) {
    this.nodeType = nodeType;
  }
  getNodeType() {
    return this.nodeType;
  }
  setName(name) {
    this.name = name;
  }
  getName() {
    return this.name;
  }
}

export default  NodeBase;
