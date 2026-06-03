/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../../interfaces/bizinst');
var IStepState = require('../../state/modelstate/interfaces/step-state');
var IModelStateListener = require('../../../bizinstcontrolcenter/interfaces/model-state-listener');

class IModelStateChangeAction {
  exec(bizinst, currentStepState, modelStateListener) {}
}

module.exports = IModelStateChangeAction;
