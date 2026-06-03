/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IModel from '../../../../../design/model/interfaces/model.js';
import IFlowto from '../../../../../design/model/flowto/interfaces/flowto.js';
import IActionNode from '../../../../../design/model/node/interfaces/action-node.js';
import ICompositeNode from '../../../../../design/model/node/interfaces/composite-node.js';
import IStateNode from '../../../../../design/model/node/interfaces/state-node.js';
import IContextBean from '../../../../interfaces/context-bean.js';

class IModelBoxFactory {
  getModelBox(model) {}
  getFlowtoBox(flowto) {}
  getActionNodeBox(actionNode) {}
  getCompositeNodeBox(compositeNode) {}
  getStateNodeBox(stateNode) {}
}

export default  IModelBoxFactory;
