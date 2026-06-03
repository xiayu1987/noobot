/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IFlowtoState from '../../../state/modelstate/interfaces/flowto-state.js';
import IBizinstModel from '../../../state/modelstate/interfaces/bizinst-model.js';
import INodeState from '../../../state/modelstate/interfaces/node-state.js';
import IPathState from '../../../state/modelstate/interfaces/path-state.js';

class IFlowtoStateBox {
  setFlowtoState(flowtoState) {}
  getFlowtoState() {}
  createPathState(bizinstModel, startNodeState, endNodeState) {}
}

export default  IFlowtoStateBox;
