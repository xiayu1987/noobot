/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IStateNode from '../../../../../design/model/node/interfaces/state-node.js';
import IBizinst from '../../../interfaces/bizinst.js';
import INodeState from '../../../state/modelstate/interfaces/node-state.js';

class IStateNodeStateBox {
  canForwardChange(bizinst) {}
  canBackwardChange(bizinst) {}
}

export default  IStateNodeStateBox;
