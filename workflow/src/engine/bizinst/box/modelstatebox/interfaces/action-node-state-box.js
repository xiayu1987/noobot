/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IActionNode from '../../../../../design/model/node/interfaces/action-node.js';
import INodeState from '../../../state/modelstate/interfaces/node-state.js';
import IStepState from '../../../state/modelstate/interfaces/step-state.js';

class IActionNodeStateBox {
  getFirstStepState() {}
  getLastStepState() {}
  createStepState() {}
  addStepState(stepState, index) {}
}

export default  IActionNodeStateBox;
