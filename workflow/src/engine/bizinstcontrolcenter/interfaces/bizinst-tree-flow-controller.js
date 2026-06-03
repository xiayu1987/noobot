/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IFlowAction = require('../../bizinst/action/interfaces/flow-action');
var IBizinstTreeBox = require('../../bizinst/box/bizinstbox/interfaces/bizinst-tree-box');
var IStepState = require('../../bizinst/state/modelstate/interfaces/step-state');
var FlowException = require('../../exception/flow-exception');

class IBizinstTreeFlowControler {
  execAction(flowAction, bizinstTreeBox, stepState) {}
}

module.exports = IBizinstTreeFlowControler;
