/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../can-persistence-base');
var IModel = require('../interfaces/model');

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

module.exports = NodeBase;
