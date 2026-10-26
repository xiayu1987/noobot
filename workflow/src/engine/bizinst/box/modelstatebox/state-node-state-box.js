/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import NodeStateBoxBase from "./node-state-box-base.js";
import EStateType from "../../../../design/model/node/enums/state-type.js";

class StateNodeStateBox extends NodeStateBoxBase {
  canForwardChange(bizinst) {
    const stateType = this.getNode().getStateType();
    if (stateType === EStateType.Branch) return true;
    if (stateType === EStateType.Merge) return this._countTotalCurrentSteps(bizinst) <= 1;
    return true;
  }

  canBackwardChange(bizinst) {
    const stateType = this.getNode().getStateType();
    if (stateType === EStateType.Branch) return this._countTotalCurrentSteps(bizinst) <= 1;
    if (stateType === EStateType.Merge) return true;
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

export default StateNodeStateBox;
