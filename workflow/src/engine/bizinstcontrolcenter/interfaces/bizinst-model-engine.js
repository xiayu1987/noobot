/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IBizinst from '../../bizinst/interfaces/bizinst.js';
import IActionNodeState from '../../bizinst/state/modelstate/interfaces/action-node-state.js';
import IStepState from '../../bizinst/state/modelstate/interfaces/step-state.js';

class IBizinstModelEngine {
  addStepState(bizinst, actionNodeState, currentStepState, index, modelStateListener) {}
}

export default  IBizinstModelEngine;
