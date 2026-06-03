/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IModelStateChangeAction = require('../../bizinst/action/interfaces/model-state-change-action');
var IBizinstTreeBox = require('../../bizinst/box/bizinstbox/interfaces/bizinst-tree-box');
var IStepState = require('../../bizinst/state/modelstate/interfaces/step-state');

class IBizinstTreeModelChangeControler {
  execAction(modelStateChangeAction, bizinstTreeBox, stepState) {}
}

module.exports = IBizinstTreeModelChangeControler;
