/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../can-persistence-base.js';
import FlowProcess from './proc/fschange/flow-process.js';
import IFlowProcess from './proc/fschange/interfaces/flow-process.js';
import BizinstModelChangeProcess from './proc/mschange/bizinst-model-change-process.js';
import IBizinstModelChangeProcess from './proc/mschange/interfaces/bizinst-model-change-process.js';

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

export default  Process;
