/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IFlowtoState = require('../../state/modelstate/interfaces/flowto-state');
var IBizinstModel = require('../../state/modelstate/interfaces/bizinst-model');
var INodeState = require('../../state/modelstate/interfaces/node-state');
var IPathState = require('../../state/modelstate/interfaces/path-state');
var PathState = require('../../state/modelstate/path-state');

class FlowtoStateBox {
  constructor() {
    this.flowtoState = null;
  }
  setFlowtoState(flowtoState) {
    this.flowtoState = flowtoState;
  }
  getFlowtoState() {
    return this.flowtoState;
  }
  createPathState(bizinstModel, startNodeState, endNodeState) {
    const pathState = new PathState();
    pathState.setStartNodeState(startNodeState);
    pathState.setFlowtoState(this.flowtoState);
    pathState.setEndNodeState(endNodeState);
    pathState.setBizinstModel(bizinstModel);
    return pathState;
  }
}

module.exports = FlowtoStateBox;
