/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IFlowto from '../../../../../design/model/flowto/interfaces/flowto.js';
import INode from '../../../../../design/model/node/interfaces/node.js';
import INodeState from '../../../state/modelstate/interfaces/node-state.js';
import IPathState from '../../../state/modelstate/interfaces/path-state.js';

class INodeStateBox {
  setNodeState(nodeState) {}
  getNodeState() {}
  getNode() {}
  getNodeStartFlowtos() {}
  getNodeEndFlowtos() {}
  getToThisPathState() {}
}

export default INodeStateBox;
