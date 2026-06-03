/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IStateNode = require('../../../../design/model/node/interfaces/state-node');
var IBizinst = require('../../interfaces/bizinst');
var IBizinstModel = require('../../state/modelstate/interfaces/bizinst-model');
var IStateNodeState = require('../../state/modelstate/interfaces/state-node-state');
var StateNodeState = require('../../state/modelstate/state-node-state');
var NodeBoxBase = require('./node-box-base');

class StateNodeBox extends NodeBoxBase {
  constructor() {
    super();
  }
  createNodeState(bizinstModel) {
    const result = new StateNodeState();
    result.setNode(this.getNode());
    result.setBizinstModel(bizinstModel);
    return result;
  }
  canForwardChange(bizinst) {
    return true;
  }
  canBackwardChange(bizinst) {
    return true;
  }
  getLastForwardChangeStateNodeStates(bizinst) {
    const result = [];
    const stateNodeStates = bizinst.getState().getCurrentState().getStateNodeStates();
    for (const stateNodeState of stateNodeStates) {
      result.push(stateNodeState);
    }
    return result;
  }
}

module.exports = StateNodeBox;
