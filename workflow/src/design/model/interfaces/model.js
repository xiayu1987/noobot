/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICanPersistence from '../../../interfaces/can-persistence.js';
import IFlowto from '../flowto/interfaces/flowto.js';
import INodeLineRLAT from '../flowto/interfaces/node-line-rlat.js';
import INode from '../node/interfaces/node.js';

class IModel {
  getNodes() {}
  setNodes(nodes) {}
  getFlowtos() {}
  setFlowtos(flowtos) {}
  getNodeLineRLATs() {}
  setNodeLineRLATs(nodeLineRLAT) {}
}

export default  IModel;
