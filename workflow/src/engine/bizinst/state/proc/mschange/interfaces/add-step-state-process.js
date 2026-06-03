/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../../../interfaces/can-persistence');
var IActionNodeState = require('../../../modelstate/interfaces/action-node-state');
var IStepState = require('../../../modelstate/interfaces/step-state');

class IAddStepStateProcess {
  setIndex(index) {}
  getIndex() {}
  setActionNodeState(actionNodeState) {}
  getActionNodeState() {}
  setStepState(stepState) {}
  getStepState() {}
  setHandleStepState(handleStepState) {}
  getHandleStepState() {}
}

module.exports = IAddStepStateProcess;
