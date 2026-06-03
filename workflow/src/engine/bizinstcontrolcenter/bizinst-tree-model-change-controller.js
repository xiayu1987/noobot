/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IModelStateChangeAction from '../bizinst/action/interfaces/model-state-change-action.js';
import IBizinstTreeBox from '../bizinst/box/bizinstbox/interfaces/bizinst-tree-box.js';
import IStepState from '../bizinst/state/modelstate/interfaces/step-state.js';
import ModelStateListener from './model-state-listener.js';

class BizinstTreeModelChangeControler {
  constructor() {
  }
  execAction(modelStateChangeAction, bizinstTreeBox, stepState) {
    var modelStateListener = new ModelStateListener();
    modelStateListener.setBizinstTreeBox(bizinstTreeBox);
    modelStateChangeAction.exec(bizinstTreeBox.getCurrentBizinst(stepState), stepState, modelStateListener);
  }
}

export default  BizinstTreeModelChangeControler;
