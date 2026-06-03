/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IActionNode = require('../../../../design/model/node/interfaces/action-node');
var NodeStateBase = require('./node-state-base');

class ActionNodeState extends NodeStateBase {
  constructor() {
    super();
    this.stepStates = null;
  }
  setStepStates(stepStates) {
    this.stepStates = stepStates;
  }
  getStepStates() {
    return this.stepStates;
  }
}

module.exports = ActionNodeState;
