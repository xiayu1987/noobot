/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICanPersistence from '../../../../../interfaces/can-persistence.js';
import IFlowtoState from '../flowto-state.js';
import INodeState from './node-state.js';

class IPathState {
  setBizinstModel(bizinstModel) {}
  getBizinstModel() {}
  setStartNodeState(startNodeState) {}
  getStartNodeState() {}
  setEndNodeState(endNodeState) {}
  getEndNodeState() {}
  setFlowtoState(flowtoState) {}
  getFlowtoState() {}
}

export default  IPathState;
