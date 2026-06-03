/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import NodeBase from './node-base.js';

class StateNode extends NodeBase {
  constructor() {
    super();
    this.stateType = null;
  }
  setStateType(stateType) {
    this.stateType = stateType;
  }
  getStateType() {
    return this.stateType;
  }
}

export default  StateNode;
