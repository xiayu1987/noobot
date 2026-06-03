/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IContextBean = require('../../../../interfaces/context-bean');
var IActionNodeState = require('../../../state/modelstate/interfaces/action-node-state');
var ICompositeNodeState = require('../../../state/modelstate/interfaces/composite-node-state');
var IFlowtoState = require('../../../state/modelstate/interfaces/flowto-state');
var IStateNodeState = require('../../../state/modelstate/interfaces/state-node-state');
var IStepState = require('../../../state/modelstate/interfaces/step-state');

class IModelStateBoxFactory {
  getFlowtoStateBox(flowtoState) {}
  getActionNodeStateBox(actionNodeState) {}
  getCompositeNodeStateBox(compositeNodeState) {}
  getStateNodeStateBox(stateNodeState) {}
  getStepStateBox(stepState) {}
}

module.exports = IModelStateBoxFactory;
