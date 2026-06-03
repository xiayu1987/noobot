/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IActionNode = require('../../../../../design/model/node/interfaces/action-node');
var INodeState = require('../../../state/modelstate/interfaces/node-state');
var IStepState = require('../../../state/modelstate/interfaces/step-state');

class IActionNodeStateBox {
  getFirstStepState() {}
  getLastStepState() {}
  createStepState() {}
  addStepState(stepState, index) {}
}

module.exports = IActionNodeStateBox;
