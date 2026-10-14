/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import AddStepStateProcess from "../bizinst/state/proc/mschange/add-step-state-process.js";

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
    var process = new AddStepStateProcess();
    process.setActionNodeState(actionNodeState);
    process.setStepState(stepState);
    process.setIndex(index);
    process.setHandleStepState(handleStepState);
    this.getRealTimeProcess(bizinst)
      .getBizinstModelChangeProcess()
      .getAddStepStateProcesses()
      .push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }
  getRealTimeProcess(bizinst) {
    return this.bizinstTreeBox.getRealTimeProcess(bizinst);
  }
}

export default ModelStateListener;
