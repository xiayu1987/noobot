/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IFlowto from '../../../../../design/model/flowto/interfaces/flowto.js';
import INode from '../../../../../design/model/node/interfaces/node.js';
import IBizinstModel from '../../../state/modelstate/interfaces/bizinst-model.js';
import INodeState from '../../../state/modelstate/interfaces/node-state.js';

class INodeBox {
  setNode(node) {}
  getNode() {}
  getNodeStartFlowtos() {}
  getNodeEndFlowtos() {}
  createNodeState(modelState) {}
}

export default INodeBox;
