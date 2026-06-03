/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../../interfaces/can-persistence');
var IFlowtoState = require('../flowto-state');
var INodeState = require('./node-state');

class IPathState {
  setBizinstModel(bizinstModel) {}
  getBizinstModel() {}
  setStartNodeState(startNodeState) {}
  getStartNodeState() {}
  setEndNodeState(endNodeState) {}
  getEndNodeState() {}
  setFlowtoState(flowtoState) {}
  getFlowtoState() {}
}

module.exports = IPathState;
