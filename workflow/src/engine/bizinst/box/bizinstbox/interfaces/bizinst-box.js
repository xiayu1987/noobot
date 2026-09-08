/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class IBizinstBox {
  setBizinst(bizinst) {}
  getBizinst() {}
  getRealTimeProcess() {}
  resetRealTimeProcess() {}
  saveState(actionNodeStateProcess) {}
  saveState(compositeNodeStateProcess) {}
  saveState(stateNodeStateProcess) {}
  saveState(discoverModelStateProcess) {}
  saveState(pathStateProcess) {}
  saveState(addStepStateProcess) {}
  saveProcess() {}
}

export default IBizinstBox;
