/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IModel = require('../../../../../design/model/interfaces/model');
var IFlowto = require('../../../../../design/model/flowto/interfaces/flowto');
var IActionNode = require('../../../../../design/model/node/interfaces/action-node');
var ICompositeNode = require('../../../../../design/model/node/interfaces/composite-node');
var IStateNode = require('../../../../../design/model/node/interfaces/state-node');
var IContextBean = require('../../../../interfaces/context-bean');

class IModelBoxFactory {
  getModelBox(model) {}
  getFlowtoBox(flowto) {}
  getActionNodeBox(actionNode) {}
  getCompositeNodeBox(compositeNode) {}
  getStateNodeBox(stateNode) {}
}

module.exports = IModelBoxFactory;
