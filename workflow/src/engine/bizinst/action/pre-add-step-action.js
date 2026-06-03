/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IBizinst from '../interfaces/bizinst.js';
import IActionNodeState from '../state/modelstate/interfaces/action-node-state.js';
import IStepState from '../state/modelstate/interfaces/step-state.js';
import BizinstModelEngine from '../../bizinstcontrolcenter/bizinst-model-engine.js';
import IModelStateListener from '../../bizinstcontrolcenter/interfaces/model-state-listener.js';
import ActionBase from './action-base.js';

class PreAddStepAction extends ActionBase {
  constructor() {
    super();
  }
  getName() {
    return "前加步骤";
  }
  exec(bizinst, currentStepState, modelStateListener) {
    var actionNodeState = currentStepState.getActionNodeState();
    var index = actionNodeState.getStepStates().indexOf(currentStepState) - 1;
    BizinstModelEngine.getInstance().addStepState(bizinst, currentStepState.getActionNodeState(), currentStepState, index, modelStateListener);
  }
}

export default  PreAddStepAction;
