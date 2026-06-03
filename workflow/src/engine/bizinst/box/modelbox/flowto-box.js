/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IFlowto = require('../../../../design/model/flowto/interfaces/flowto');
var IBizinst = require('../../interfaces/bizinst');
var FlowtoState = require('../../state/modelstate/flowto-state');
var IFlowtoState = require('../../state/modelstate/interfaces/flowto-state');
var IBizinstModel = require('../../state/modelstate/interfaces/bizinst-model');

class FlowtoBox {
  constructor() {
    this.flowto = null;
  }
  setFlowto(flowto) {
    this.flowto = flowto;
  }
  getFlowto() {
    return this.flowto;
  }
  canFlow(bizinst) {
    return true;
  }
  createFlowtoState(bizinstModel) {
    const result = new FlowtoState();
    result.setFlowto(this.getFlowto());
    result.setBizinstModel(bizinstModel);
    return result;
  }
}

module.exports = FlowtoBox;
