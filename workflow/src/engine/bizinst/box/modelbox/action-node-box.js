/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IActionNode = require('../../../../design/model/node/interfaces/action-node');
var WorkFlowContext = require('../../../work-flow-context');
var IActionNodeStateBox = require('../modelstatebox/interfaces/action-node-state-box');
var IModelStateBoxFactory = require('../modelstatebox/interfaces/model-state-box-factory');
var ActionNodeState = require('../../state/modelstate/action-node-state');
var IActionNodeState = require('../../state/modelstate/interfaces/action-node-state');
var IBizinstModel = require('../../state/modelstate/interfaces/bizinst-model');
var IStepState = require('../../state/modelstate/interfaces/step-state');
var ModelStateBoxFactory = require('../modelstatebox/model-state-box-factory');
var NodeBoxBase = require('./node-box-base');

class ActionNodeBox extends NodeBoxBase {
  constructor() {
    super();
  }
  createNodeState(bizinstModel) {
    const result = new ActionNodeState();
    result.setNode(this.getNode());
    result.setBizinstModel(bizinstModel);
    const modelStateBoxFactory =
      WorkFlowContext.getInstance().getContextBean(WorkFlowContext.MODELSTATEBOXFACTORYNAME) || ModelStateBoxFactory.getInstance();
    const actionNodeStateBox = modelStateBoxFactory.getActionNodeStateBox(result);
    const stepStates = [];
    stepStates.push(actionNodeStateBox.createStepState());
    result.setStepStates(stepStates);
    return result;
  }
}

module.exports = ActionNodeBox;
