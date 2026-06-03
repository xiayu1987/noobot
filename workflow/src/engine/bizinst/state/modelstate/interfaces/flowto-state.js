/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../../interfaces/can-persistence');
var IFlowto = require('../../../../../design/model/flowto/interfaces/flowto');

class IFlowtoState {
  setFlowto(flowto) {}
  getFlowto() {}
  setBizinstModel(bizinstModel) {}
  getBizinstModel() {}
}

module.exports = IFlowtoState;
