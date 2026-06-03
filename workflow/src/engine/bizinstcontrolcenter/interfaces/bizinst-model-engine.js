/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../../bizinst/interfaces/bizinst');
var IActionNodeState = require('../../bizinst/state/modelstate/interfaces/action-node-state');
var IStepState = require('../../bizinst/state/modelstate/interfaces/step-state');

class IBizinstModelEngine {
  addStepState(bizinst, actionNodeState, currentStepState, index, modelStateListener) {}
}

module.exports = IBizinstModelEngine;
