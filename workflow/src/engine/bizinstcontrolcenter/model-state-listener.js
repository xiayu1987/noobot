/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IBizinst from '../bizinst/interfaces/bizinst.js';
import IBizinstTreeBox from '../bizinst/box/bizinstbox/interfaces/bizinst-tree-box.js';
import IProcess from '../bizinst/state/interfaces/process.js';
import IActionNodeState from '../bizinst/state/modelstate/interfaces/action-node-state.js';
import IStepState from '../bizinst/state/modelstate/interfaces/step-state.js';
import AddStepStateProcess from '../bizinst/state/proc/mschange/add-step-state-process.js';
import IAddStepStateProcess from '../bizinst/state/proc/mschange/interfaces/add-step-state-process.js';

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

export default  ModelStateListener;
