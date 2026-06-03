/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../../can-persistence-base');
var IFlowto = require('../../../../design/model/flowto/interfaces/flowto');

class FlowtoState extends CanPersistenceBase {
  constructor() {
    super();
    this.flowto = null;
    this.bizinstModel = null;
  }
  setFlowto(flowto) {
    this.flowto = flowto;
  }
  getFlowto() {
    return this.flowto;
  }
  setBizinstModel(bizinstModel) {
    this.bizinstModel = bizinstModel;
  }
  getBizinstModel() {
    return this.bizinstModel;
  }
}

module.exports = FlowtoState;
