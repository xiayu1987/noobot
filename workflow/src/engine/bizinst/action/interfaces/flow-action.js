/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../../interfaces/bizinst');
var IStepState = require('../../state/modelstate/interfaces/step-state');
var IFlowListener = require('../../../bizinstcontrolcenter/interfaces/flow-listener');
var FlowException = require('../../../exception/flow-exception');

class IFlowAction {
  exec(bizinst, stepState, flowListener) {}
}

module.exports = IFlowAction;
