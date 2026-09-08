/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import BizinstModelEngine from "../../bizinstcontrolcenter/bizinst-model-engine.js";
import ActionBase from "./action-base.js";

class NextAddStepAction extends ActionBase {
  constructor() {
    super();
  }
  getName() {
    return "后加步骤";
  }
  exec(bizinst, currentStepState, modelStateListener) {
    var actionNodeState = currentStepState.getActionNodeState();
    var index = actionNodeState.getStepStates().indexOf(currentStepState) + 1;
    BizinstModelEngine.getInstance().addStepState(
      bizinst,
      currentStepState.getActionNodeState(),
      currentStepState,
      index,
      modelStateListener,
    );
  }
}

export default NextAddStepAction;
