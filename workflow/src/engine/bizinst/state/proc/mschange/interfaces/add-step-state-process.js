/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICanPersistence from '../../../../../../interfaces/can-persistence.js';
import IActionNodeState from '../../../modelstate/interfaces/action-node-state.js';
import IStepState from '../../../modelstate/interfaces/step-state.js';

class IAddStepStateProcess {
  setIndex(index) {}
  getIndex() {}
  setActionNodeState(actionNodeState) {}
  getActionNodeState() {}
  setStepState(stepState) {}
  getStepState() {}
  setHandleStepState(handleStepState) {}
  getHandleStepState() {}
}

export default  IAddStepStateProcess;
