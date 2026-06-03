/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IActionNode = require('../../../../../design/model/node/interfaces/action-node');
var IStepState = require('../../modelstate/interfaces/step-state');
var NodeStateProcessBase = require('./node-state-process-base');

class ActionNodeStateProcess extends NodeStateProcessBase {
  constructor() {
    super();
    this.stepState = null;
    this.actionNodeStateProcessHandleWay = null;
  }
  setStepState(stepState) {
    this.stepState = stepState;
  }
  getStepState() {
    return this.stepState;
  }
  setActionNodeStateProcessHandleWay(actionNodeStateProcessHandleWay) {
    this.actionNodeStateProcessHandleWay = actionNodeStateProcessHandleWay;
  }
  getActionNodeStateProcessHandleWay() {
    return this.actionNodeStateProcessHandleWay;
  }
}

module.exports = ActionNodeStateProcess;
