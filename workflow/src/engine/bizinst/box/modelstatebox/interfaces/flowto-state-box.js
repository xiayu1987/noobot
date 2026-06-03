/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IFlowtoState = require('../../../state/modelstate/interfaces/flowto-state');
var IBizinstModel = require('../../../state/modelstate/interfaces/bizinst-model');
var INodeState = require('../../../state/modelstate/interfaces/node-state');
var IPathState = require('../../../state/modelstate/interfaces/path-state');

class IFlowtoStateBox {
  setFlowtoState(flowtoState) {}
  getFlowtoState() {}
  createPathState(bizinstModel, startNodeState, endNodeState) {}
}

module.exports = IFlowtoStateBox;
