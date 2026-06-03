/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IStateNode from '../../../../../design/model/node/interfaces/state-node.js';
import NodeStateProcessBase from './node-state-process-base.js';

class StateNodeStateProcess extends NodeStateProcessBase {
  constructor() {
    super();
    this.stateNodeStateProcessHandleWay = null;
  }
  setStateNodeStateProcessHandleWay(stateNodeStateProcessHandleWay) {
    this.stateNodeStateProcessHandleWay = stateNodeStateProcessHandleWay;
  }
  getStateNodeStateProcessHandleWay() {
    return this.stateNodeStateProcessHandleWay;
  }
}

export default  StateNodeStateProcess;
