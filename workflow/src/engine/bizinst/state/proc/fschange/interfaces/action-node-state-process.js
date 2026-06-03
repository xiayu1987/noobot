/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IActionNode = require('../../../../../../design/model/node/interfaces/action-node');
var IStepState = require('../../../modelstate/interfaces/step-state');

class IActionNodeStateProcess {
  setStepState(stepState) {}
  getStepState() {}
  setActionNodeStateProcessHandleWay(actionNodeStateProcessHandleWay) {}
  getActionNodeStateProcessHandleWay() {}
}

module.exports = IActionNodeStateProcess;
