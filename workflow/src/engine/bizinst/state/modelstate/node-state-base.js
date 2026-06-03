/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../../can-persistence-base');

class NodeStateBase extends CanPersistenceBase {
  constructor() {
    super();
    this.node = null;
    this.bizinstModel = null;
  }

  setNode(node) {
    this.node = node;
  }

  getNode() {
    return this.node;
  }

  setBizinstModel(bizinstModel) {
    this.bizinstModel = bizinstModel;
  }

  getBizinstModel() {
    return this.bizinstModel;
  }
}

module.exports = NodeStateBase;
