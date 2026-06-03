/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../interfaces/bizinst');
var IStepState = require('../state/modelstate/interfaces/step-state');
var BizinstFlowEngine = require('../../bizinstcontrolcenter/bizinst-flow-engine');
var IFlowListener = require('../../bizinstcontrolcenter/interfaces/flow-listener');
var FlowException = require('../../exception/flow-exception');
var ActionBase = require('./action-base');

class StopAction extends ActionBase {
  constructor() {
    super();
  }
  getName() {
    return "终止";
  }
  exec(bizinst, stepState, flowListener) {
    BizinstFlowEngine.getInstance().stopBizinst(bizinst, stepState, flowListener);
  }
}

module.exports = StopAction;
