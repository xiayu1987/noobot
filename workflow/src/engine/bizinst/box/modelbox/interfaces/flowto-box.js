/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IFlowto = require('../../../../../design/model/flowto/interfaces/flowto');
var IBizinst = require('../../../interfaces/bizinst');
var IFlowtoState = require('../../../state/modelstate/interfaces/flowto-state');
var IBizinstModel = require('../../../state/modelstate/interfaces/bizinst-model');

class IFlowtoBox {
  setFlowto(flowto) {}
  getFlowto() {}
  createFlowtoState(bizinstModel) {}
  canFlow(bizinst) {}
}

module.exports = IFlowtoBox;
