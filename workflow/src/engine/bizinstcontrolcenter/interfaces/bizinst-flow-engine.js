/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IModel = require('../../../design/model/interfaces/model');
var IBizinst = require('../../bizinst/interfaces/bizinst');
var IBusiness = require('../../bizinst/interfaces/business');
var IStepState = require('../../bizinst/state/modelstate/interfaces/step-state');
var FlowException = require('../../exception/flow-exception');

class IBizinstFlowEngine {
  createBizinst(business, model) {}
  startBizinst(bizinst, flowListener) {}
  openBizinst(bizinst, flowListener) {}
  stopBizinst(bizinst, currentStepState, flowListener) {}
  goNext(bizinst, currentStepState, flowListener) {}
  goPre(bizinst, currentStepState, flowListener) {}
}

module.exports = IBizinstFlowEngine;
