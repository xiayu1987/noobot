/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var NodeStateBoxBase = require('./node-state-box-base');

class StateNodeStateBox extends NodeStateBoxBase {
  canForwardChange(bizinst) {
    const stateType = this.getNode().getStateType();
    if (stateType === 2) return true;
    if (stateType === 3) return this._countTotalCurrentSteps(bizinst) <= 1;
    return true;
  }

  canBackwardChange(bizinst) {
    const stateType = this.getNode().getStateType();
    if (stateType === 2) return this._countTotalCurrentSteps(bizinst) <= 1;
    if (stateType === 3) return true;
    return true;
  }

  _countTotalCurrentSteps(bizinst) {
    let total = 0;
    const loopBizinst = (b) => {
      total += b.getState().getCurrentState().getCurrentStepStates().length;
      for (const child of b.getChildBizinsts() || []) loopBizinst(child);
    };
    loopBizinst(bizinst);
    return total;
  }
}

module.exports = StateNodeStateBox;
