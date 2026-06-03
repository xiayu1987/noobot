/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var WorkFlowContext = require('../work-flow-context');
var IBizinst = require('../bizinst/interfaces/bizinst');
var IActionNodeStateBox = require('../bizinst/box/modelstatebox/interfaces/action-node-state-box');
var IModelStateBoxFactory = require('../bizinst/box/modelstatebox/interfaces/model-state-box-factory');
var IActionNodeState = require('../bizinst/state/modelstate/interfaces/action-node-state');
var IStepState = require('../bizinst/state/modelstate/interfaces/step-state');
var ModelStateBoxFactory = require('../bizinst/box/modelstatebox/model-state-box-factory');

class BizinstModelEngine {
  constructor() {}
  static getInstance() {
    if (!BizinstModelEngine.instance) BizinstModelEngine.instance = new BizinstModelEngine();
    return BizinstModelEngine.instance;
  }
  addStepState(bizinst, actionNodeState, currentStepState, index, modelStateListener) {
    const modelStateBoxFactory =
      WorkFlowContext.getInstance().getContextBean(WorkFlowContext.MODELSTATEBOXFACTORYNAME) || ModelStateBoxFactory.getInstance();
    const actionNodeStateBox = modelStateBoxFactory.getActionNodeStateBox(actionNodeState);
    const stepState = actionNodeStateBox.createStepState();
    modelStateListener.addStepState(bizinst, currentStepState, actionNodeState, stepState, index);
  }
}
BizinstModelEngine.instance = new BizinstModelEngine();

module.exports = BizinstModelEngine;
