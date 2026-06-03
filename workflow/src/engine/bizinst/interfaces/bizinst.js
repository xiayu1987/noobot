/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../interfaces/can-persistence');
var IModel = require('../../../design/model/interfaces/model');
var IProcessChain = require('../state/interfaces/process-chain');
var IState = require('../state/interfaces/state');

class IBizinst {
  setBusiness(business) {}
  getBusiness() {}
  setModel(model) {}
  getModel() {}
  setParentBizinst(bizinst) {}
  getParentBizinst() {}
  setChildBizinsts(childBizinsts) {}
  getChildBizinsts() {}
  setProcessChain(processChain) {}
  getProcessChain() {}
  setState(state) {}
  getState() {}
  setBizinstRunState(bizinstRunState) {}
  getBizinstRunState() {}
}

module.exports = IBizinst;
