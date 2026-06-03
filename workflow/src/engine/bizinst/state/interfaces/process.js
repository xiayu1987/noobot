/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICanPersistence from '../../../../interfaces/can-persistence.js';
import IFlowProcess from '../proc/fschange/interfaces/flow-process.js';
import IBizinstModelChangeProcess from '../proc/mschange/interfaces/bizinst-model-change-process.js';

class IProcess {
  setProcessChain(processChain) {}
  getProcessChain() {}
  setFlowProcess(flowProcess) {}
  getFlowProcess() {}
  setBizinstModelChangeProcess(bizinstModelChangeProcess) {}
  getBizinstModelChangeProcess() {}
}

export default  IProcess;
