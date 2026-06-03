/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var StepState = require('../../state/modelstate/step-state');
var NodeStateBoxBase = require('./node-state-box-base');

class ActionNodeStateBox extends NodeStateBoxBase {
  getFirstStepState() {
    return this.getNodeState().getStepStates()[0];
  }

  getLastStepState() {
    const stepStates = this.getNodeState().getStepStates() || [];
    return stepStates[stepStates.length - 1];
  }

  createStepState() {
    const result = new StepState();
    result.setActionNodeState(this.getNodeState());
    return result;
  }

  addStepState(stepState, index) {
    this.getNodeState().getStepStates().splice(index, 0, stepState);
  }
}

module.exports = ActionNodeStateBox;
