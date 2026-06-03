/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../can-persistence-base.js';
import IBizinst from '../interfaces/bizinst.js';

class ProcessChain extends CanPersistenceBase {
  constructor() {
    super();
    this.bizinst = null;
    this.processes = null;
    this.processes = [];
  }
  setBizinst(bizinst) {
    this.bizinst = bizinst;
  }
  getBizinst() {
    return this.bizinst;
  }
  setProcesses(processes) {
    this.processes = processes;
  }
  getProcesses() {
    return this.processes;
  }
}

export default  ProcessChain;
