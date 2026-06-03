/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import WorkFlowContext from '../work-flow-context.js';
import IBizinst from '../bizinst/interfaces/bizinst.js';
import IActionNodeStateBox from '../bizinst/box/modelstatebox/interfaces/action-node-state-box.js';
import IModelStateBoxFactory from '../bizinst/box/modelstatebox/interfaces/model-state-box-factory.js';
import IActionNodeState from '../bizinst/state/modelstate/interfaces/action-node-state.js';
import IStepState from '../bizinst/state/modelstate/interfaces/step-state.js';
import ModelStateBoxFactory from '../bizinst/box/modelstatebox/model-state-box-factory.js';

class BizinstModelEngine {
  constructor() {}
  static getInstance() {
    if (!BizinstModelEngine.instance) BizinstModelEngine.instance = new BizinstModelEngine();
    return BizinstModelEngine.instance;
  }
  addStepState(bizinst, actionNodeState, currentStepState, index, modelStateListener) {
    const modelStateBoxFactory =
      WorkFlowContext.getInstance().getContextBean(WorkFlowContext.MODELSTATEBOXFACTORYNAME) || ModelStateBoxFactory.getInstance();
    const actionNodeStateBox = modelStateBoxFactory.getActionNodeStateBox(actionNodeState);
    const stepState = actionNodeStateBox.createStepState();
    modelStateListener.addStepState(bizinst, currentStepState, actionNodeState, stepState, index);
  }
}
BizinstModelEngine.instance = new BizinstModelEngine();

export default  BizinstModelEngine;
