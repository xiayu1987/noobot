/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../can-persistence-base');
var FlowProcess = require('./proc/fschange/flow-process');
var IFlowProcess = require('./proc/fschange/interfaces/flow-process');
var BizinstModelChangeProcess = require('./proc/mschange/bizinst-model-change-process');
var IBizinstModelChangeProcess = require('./proc/mschange/interfaces/bizinst-model-change-process');

class Process extends CanPersistenceBase {
  constructor() {
    super();
    this.processChain = null;
    this.flowProcess = null;
    this.bizinstModelChangeProcess = null;
    this.flowProcess = new FlowProcess();
    this.bizinstModelChangeProcess = new BizinstModelChangeProcess();
  }
  setProcessChain(processChain) {
    this.processChain = processChain;
  }
  getProcessChain() {
    return this.processChain;
  }
  setFlowProcess(flowProcess) {
    this.flowProcess = flowProcess;
  }
  getFlowProcess() {
    return this.flowProcess;
  }
  setBizinstModelChangeProcess(bizinstModelChangeProcess) {
    this.bizinstModelChangeProcess = bizinstModelChangeProcess;
  }
  getBizinstModelChangeProcess() {
    return this.bizinstModelChangeProcess;
  }
}

module.exports = Process;
