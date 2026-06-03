/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../can-persistence-base');
var IProcess = require('./state/interfaces/process');

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

module.exports = ProcessRecord;
