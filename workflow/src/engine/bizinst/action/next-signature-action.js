/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../interfaces/bizinst');
var IActionNodeState = require('../state/modelstate/interfaces/action-node-state');
var IStepState = require('../state/modelstate/interfaces/step-state');
var BizinstModelEngine = require('../../bizinstcontrolcenter/bizinst-model-engine');
var IModelStateListener = require('../../bizinstcontrolcenter/interfaces/model-state-listener');
var ActionBase = require('./action-base');

class NextSignatureAction extends ActionBase {
  constructor() {
    super();
  }
  getName() {
    return "后加签";
  }
  exec(bizinst, currentStepState, modelStateListener) {
    var actionNodeState = currentStepState.getActionNodeState();
    var index = actionNodeState.getStepStates().indexOf(currentStepState) + 1;
    BizinstModelEngine.getInstance().addStepState(bizinst, currentStepState.getActionNodeState(), currentStepState, index, modelStateListener);
  }
}

module.exports = NextSignatureAction;
