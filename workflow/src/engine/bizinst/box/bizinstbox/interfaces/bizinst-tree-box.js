/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class IBizinstTreeBox {
  setBizinst(bizinst) {}
  getCurrentBizinst(stepState) {}
  getRootBizinst() {}
  setBizinstTreeRecord(bizinstTreeRecord) {}
  getBizinstTreeRecord() {}
  getRealTimeProcess(bizinst) {}
  saveState(bizinst, actionNodeStateProcess) {}
  saveState(bizinst, compositeNodeStateProcess) {}
  saveState(bizinst, stateNodeStateProcess) {}
  saveState(bizinst, discoverModelStateProcess) {}
  saveState(bizinst, pathStateProcess) {}
  saveState(bizinst, addStepStateProcess) {}
  saveProcess(action) {}
}

export default IBizinstTreeBox;
