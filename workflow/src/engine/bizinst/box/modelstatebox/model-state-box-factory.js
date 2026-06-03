/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IActionNodeState = require('../../state/modelstate/interfaces/action-node-state');
var ICompositeNodeState = require('../../state/modelstate/interfaces/composite-node-state');
var IFlowtoState = require('../../state/modelstate/interfaces/flowto-state');
var IStateNodeState = require('../../state/modelstate/interfaces/state-node-state');
var IStepState = require('../../state/modelstate/interfaces/step-state');
var FlowtoStateBox = require('./flowto-state-box');
var ActionNodeStateBox = require('./action-node-state-box');
var CompositeNodeStateBox = require('./composite-node-state-box');
var StateNodeStateBox = require('./state-node-state-box');
var StepStateBox = require('./step-state-box');

class ModelStateBoxFactory {
  constructor() {
  }
  static getInstance() {
    if (!ModelStateBoxFactory.instance) ModelStateBoxFactory.instance = new ModelStateBoxFactory();
    return ModelStateBoxFactory.instance;
  }
  getFlowtoStateBox(flowtoState) {
    const result = new FlowtoStateBox();
    result.setFlowtoState(flowtoState);
    return result;
  }
  getActionNodeStateBox(actionNodeState) {
    const result = new ActionNodeStateBox();
    result.setNodeState(actionNodeState);
    return result;
  }
  getCompositeNodeStateBox(compositeNodeState) {
    const result = new CompositeNodeStateBox();
    result.setNodeState(compositeNodeState);
    return result;
  }
  getStateNodeStateBox(stateNodeState) {
    const result = new StateNodeStateBox();
    result.setNodeState(stateNodeState);
    return result;
  }
  getStepStateBox(stepState) {
    const result = new StepStateBox();
    result.setStepState(stepState);
    return result;
  }
}
ModelStateBoxFactory.instance = new ModelStateBoxFactory();

module.exports = ModelStateBoxFactory;
