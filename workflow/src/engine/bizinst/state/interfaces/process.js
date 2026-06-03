/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../interfaces/can-persistence');
var IFlowProcess = require('../proc/fschange/interfaces/flow-process');
var IBizinstModelChangeProcess = require('../proc/mschange/interfaces/bizinst-model-change-process');

class IProcess {
  setProcessChain(processChain) {}
  getProcessChain() {}
  setFlowProcess(flowProcess) {}
  getFlowProcess() {}
  setBizinstModelChangeProcess(bizinstModelChangeProcess) {}
  getBizinstModelChangeProcess() {}
}

module.exports = IProcess;
