/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IModel = require('../../../design/model/interfaces/model');
var IActionRecord = require('../../bizinst/interfaces/action-record');
var IBizinst = require('../../bizinst/interfaces/bizinst');
var IBizinstTreeRecord = require('../../bizinst/interfaces/bizinst-tree-record');
var IBusiness = require('../../bizinst/interfaces/business');
var IAction = require('../../bizinst/action/interfaces/action');
var IStepState = require('../../bizinst/state/modelstate/interfaces/step-state');
var FlowException = require('../../exception/flow-exception');

class IBizinstTreeControlCenter {
  startBizinst(business, model) {}
  execAction(action, bizinst, stepState, bizinstTreeRecord) {}
}

module.exports = IBizinstTreeControlCenter;
