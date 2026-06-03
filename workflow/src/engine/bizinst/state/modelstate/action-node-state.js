/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IActionNode from '../../../../design/model/node/interfaces/action-node.js';
import NodeStateBase from './node-state-base.js';

class ActionNodeState extends NodeStateBase {
  constructor() {
    super();
    this.stepStates = null;
  }
  setStepStates(stepStates) {
    this.stepStates = stepStates;
  }
  getStepStates() {
    return this.stepStates;
  }
}

export default  ActionNodeState;
