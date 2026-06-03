/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IContextBean from '../../../../interfaces/context-bean.js';
import IActionNodeState from '../../../state/modelstate/interfaces/action-node-state.js';
import ICompositeNodeState from '../../../state/modelstate/interfaces/composite-node-state.js';
import IFlowtoState from '../../../state/modelstate/interfaces/flowto-state.js';
import IStateNodeState from '../../../state/modelstate/interfaces/state-node-state.js';
import IStepState from '../../../state/modelstate/interfaces/step-state.js';

class IModelStateBoxFactory {
  getFlowtoStateBox(flowtoState) {}
  getActionNodeStateBox(actionNodeState) {}
  getCompositeNodeStateBox(compositeNodeState) {}
  getStateNodeStateBox(stateNodeState) {}
  getStepStateBox(stepState) {}
}

export default  IModelStateBoxFactory;
