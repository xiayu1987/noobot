/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IActionNode from '../../../../../design/model/node/interfaces/action-node.js';
import IStepState from '../../modelstate/interfaces/step-state.js';
import NodeStateProcessBase from './node-state-process-base.js';

class ActionNodeStateProcess extends NodeStateProcessBase {
  constructor() {
    super();
    this.stepState = null;
    this.actionNodeStateProcessHandleWay = null;
  }
  setStepState(stepState) {
    this.stepState = stepState;
  }
  getStepState() {
    return this.stepState;
  }
  setActionNodeStateProcessHandleWay(actionNodeStateProcessHandleWay) {
    this.actionNodeStateProcessHandleWay = actionNodeStateProcessHandleWay;
  }
  getActionNodeStateProcessHandleWay() {
    return this.actionNodeStateProcessHandleWay;
  }
}

export default  ActionNodeStateProcess;
