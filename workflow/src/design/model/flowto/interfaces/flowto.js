/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../interfaces/can-persistence');
var INode = require('../../node/interfaces/node');

class IFlowto {
  getStartNode() {}
  setStartNode(startNode) {}
  getEndNode() {}
  setEndNode(endNode) {}
  setName(name) {}
  getName() {}
}

module.exports = IFlowto;
