/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICanPersistence from '../../../../interfaces/can-persistence.js';
import IBizinst from '../../interfaces/bizinst.js';

class IProcessChain {
  setBizinst(bizinst) {}
  getBizinst() {}
  setProcesses(processes) {}
  getProcesses() {}
}

export default  IProcessChain;
