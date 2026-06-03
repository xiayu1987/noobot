/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IActionNodeState from '../../state/modelstate/interfaces/action-node-state.js';
import ICompositeNodeState from '../../state/modelstate/interfaces/composite-node-state.js';
import IFlowtoState from '../../state/modelstate/interfaces/flowto-state.js';
import IStateNodeState from '../../state/modelstate/interfaces/state-node-state.js';
import IStepState from '../../state/modelstate/interfaces/step-state.js';
import FlowtoStateBox from './flowto-state-box.js';
import ActionNodeStateBox from './action-node-state-box.js';
import CompositeNodeStateBox from './composite-node-state-box.js';
import StateNodeStateBox from './state-node-state-box.js';
import StepStateBox from './step-state-box.js';

class ModelStateBoxFactory {
  constructor() {
  }
  static getInstance() {
    if (!ModelStateBoxFactory.instance) ModelStateBoxFactory.instance = new ModelStateBoxFactory();
    return ModelStateBoxFactory.instance;
  }
  getFlowtoStateBox(flowtoState) {
    const result = new FlowtoStateBox();
    result.setFlowtoState(flowtoState);
    return result;
  }
  getActionNodeStateBox(actionNodeState) {
    const result = new ActionNodeStateBox();
    result.setNodeState(actionNodeState);
    return result;
  }
  getCompositeNodeStateBox(compositeNodeState) {
    const result = new CompositeNodeStateBox();
    result.setNodeState(compositeNodeState);
    return result;
  }
  getStateNodeStateBox(stateNodeState) {
    const result = new StateNodeStateBox();
    result.setNodeState(stateNodeState);
    return result;
  }
  getStepStateBox(stepState) {
    const result = new StepStateBox();
    result.setStepState(stepState);
    return result;
  }
}
ModelStateBoxFactory.instance = new ModelStateBoxFactory();

export default  ModelStateBoxFactory;
