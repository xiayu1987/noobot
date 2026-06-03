/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICanPersistence from '../../../../../interfaces/can-persistence.js';
import IState from '../../interfaces/state.js';

class IBizinstModel {
  setState(state) {}
  getState() {}
  setActionNodeStates(actionNodeStates) {}
  getActionNodeStates() {}
  setCompositeNodeStates(compositeNodeStates) {}
  getCompositeNodeStates() {}
  setStateNodeStates(stateNodeStates) {}
  getStateNodeStates() {}
  setFlowtoStates(flowtoStates) {}
  getFlowtoStates() {}
  setPathStates(pathStates) {}
  getPathStates() {}
}

export default  IBizinstModel;
