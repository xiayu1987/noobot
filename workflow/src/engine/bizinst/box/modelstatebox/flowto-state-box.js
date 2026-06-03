/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IFlowtoState from '../../state/modelstate/interfaces/flowto-state.js';
import IBizinstModel from '../../state/modelstate/interfaces/bizinst-model.js';
import INodeState from '../../state/modelstate/interfaces/node-state.js';
import IPathState from '../../state/modelstate/interfaces/path-state.js';
import PathState from '../../state/modelstate/path-state.js';

class FlowtoStateBox {
  constructor() {
    this.flowtoState = null;
  }
  setFlowtoState(flowtoState) {
    this.flowtoState = flowtoState;
  }
  getFlowtoState() {
    return this.flowtoState;
  }
  createPathState(bizinstModel, startNodeState, endNodeState) {
    const pathState = new PathState();
    pathState.setStartNodeState(startNodeState);
    pathState.setFlowtoState(this.flowtoState);
    pathState.setEndNodeState(endNodeState);
    pathState.setBizinstModel(bizinstModel);
    return pathState;
  }
}

export default  FlowtoStateBox;
