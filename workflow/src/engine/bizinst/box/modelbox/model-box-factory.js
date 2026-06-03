/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IModel = require('../../../../design/model/interfaces/model');
var IFlowto = require('../../../../design/model/flowto/interfaces/flowto');
var IActionNode = require('../../../../design/model/node/interfaces/action-node');
var ICompositeNode = require('../../../../design/model/node/interfaces/composite-node');
var IStateNode = require('../../../../design/model/node/interfaces/state-node');
var ModelBox = require('./model-box');
var FlowtoBox = require('./flowto-box');
var ActionNodeBox = require('./action-node-box');
var CompositeNodeBox = require('./composite-node-box');
var StateNodeBox = require('./state-node-box');

class ModelBoxFactory {
  constructor() {
  }
  static getInstance() {
    if (!ModelBoxFactory.instance) ModelBoxFactory.instance = new ModelBoxFactory();
    return ModelBoxFactory.instance;
  }
  getModelBox(model) {
    const result = new ModelBox();
    result.setModel(model);
    return result;
  }
  getFlowtoBox(flowto) {
    const result = new FlowtoBox();
    result.setFlowto(flowto);
    return result;
  }
  getActionNodeBox(actionNode) {
    const result = new ActionNodeBox();
    result.setNode(actionNode);
    return result;
  }
  getCompositeNodeBox(compositeNode) {
    const result = new CompositeNodeBox();
    result.setNode(compositeNode);
    return result;
  }
  getStateNodeBox(stateNode) {
    const result = new StateNodeBox();
    result.setNode(stateNode);
    return result;
  }
}
ModelBoxFactory.instance = new ModelBoxFactory();

module.exports = ModelBoxFactory;
