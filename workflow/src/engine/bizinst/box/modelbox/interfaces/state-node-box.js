/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IStateNode from '../../../../../design/model/node/interfaces/state-node.js';
import IBizinst from '../../../interfaces/bizinst.js';
import IBizinstModel from '../../../state/modelstate/interfaces/bizinst-model.js';
import IStateNodeState from '../../../state/modelstate/interfaces/state-node-state.js';

class IStateNodeBox {
  canForwardChange(bizinst) {}
  canBackwardChange(bizinst) {}
  getLastForwardChangeStateNodeStates(bizinst) {}
  createNodeState(bizinstModel) {}
}

export default  IStateNodeBox;
