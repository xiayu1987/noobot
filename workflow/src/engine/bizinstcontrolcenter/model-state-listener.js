/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../bizinst/interfaces/bizinst');
var IBizinstTreeBox = require('../bizinst/box/bizinstbox/interfaces/bizinst-tree-box');
var IProcess = require('../bizinst/state/interfaces/process');
var IActionNodeState = require('../bizinst/state/modelstate/interfaces/action-node-state');
var IStepState = require('../bizinst/state/modelstate/interfaces/step-state');
var AddStepStateProcess = require('../bizinst/state/proc/mschange/add-step-state-process');
var IAddStepStateProcess = require('../bizinst/state/proc/mschange/interfaces/add-step-state-process');

class ModelStateListener {
  constructor() {
    this.bizinstTreeBox = null;
  }
  getBizinstTreeBox() {
    return this.bizinstTreeBox;
  }
  setBizinstTreeBox(bizinstTreeBox) {
    this.bizinstTreeBox = bizinstTreeBox;
  }
  addStepState(bizinst, handleStepState, actionNodeState, stepState, index) {
    console.log("添加步骤状态：" + actionNodeState.getNode().getName() + "下索引" + index);
    var process = new AddStepStateProcess();
    process.setActionNodeState(actionNodeState);
    process.setStepState(stepState);
    process.setIndex(index);
    process.setHandleStepState(handleStepState);
    this.getRealTimeProcess(bizinst).getBizinstModelChangeProcess().getAddStepStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }
  getRealTimeProcess(bizinst) {
    return this.bizinstTreeBox.getRealTimeProcess(bizinst);
  }
}

module.exports = ModelStateListener;
