/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../interfaces/can-persistence');
var IModel = require('../../interfaces/model');

class INode {
  setModel(model) {}
  getModel() {}
  setNodeType(nodeType) {}
  getNodeType() {}
  setName(name) {}
  getName() {}
}

module.exports = INode;
