/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../can-persistence-base.js';
import IProcess from './state/interfaces/process.js';

class ProcessRecord extends CanPersistenceBase {
  constructor() {
    super();
    this.process = null;
    this.bizinst = null;
  }
  setProcess(process) {
    this.process = process;
  }
  getProcess() {
    return this.process;
  }
  setBizinst(bizinst) {
    this.bizinst = bizinst;
  }
  getBizinst() {
    return this.bizinst;
  }
}

export default  ProcessRecord;
