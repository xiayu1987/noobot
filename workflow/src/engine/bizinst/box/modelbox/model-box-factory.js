/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ModelBox from "./model-box.js";
import FlowtoBox from "./flowto-box.js";
import ActionNodeBox from "./action-node-box.js";
import CompositeNodeBox from "./composite-node-box.js";
import StateNodeBox from "./state-node-box.js";

class ModelBoxFactory {
  constructor() {}
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

export default ModelBoxFactory;
