/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IStateNode from '../../../../design/model/node/interfaces/state-node.js';
import IBizinst from '../../interfaces/bizinst.js';
import IBizinstModel from '../../state/modelstate/interfaces/bizinst-model.js';
import IStateNodeState from '../../state/modelstate/interfaces/state-node-state.js';
import StateNodeState from '../../state/modelstate/state-node-state.js';
import NodeBoxBase from './node-box-base.js';

class StateNodeBox extends NodeBoxBase {
  constructor() {
    super();
  }
  createNodeState(bizinstModel) {
    const result = new StateNodeState();
    result.setNode(this.getNode());
    result.setBizinstModel(bizinstModel);
    return result;
  }
  canForwardChange(bizinst) {
    return true;
  }
  canBackwardChange(bizinst) {
    return true;
  }
  getLastForwardChangeStateNodeStates(bizinst) {
    const result = [];
    const stateNodeStates = bizinst.getState().getCurrentState().getStateNodeStates();
    for (const stateNodeState of stateNodeStates) {
      result.push(stateNodeState);
    }
    return result;
  }
}

export default  StateNodeBox;
