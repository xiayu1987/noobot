/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../interfaces/can-persistence');
var IProcess = require('../state/interfaces/process');

class IProcessRecord {
  setProcess(process) {}
  getProcess() {}
  setBizinst(bizinst) {}
  getBizinst() {}
}

module.exports = IProcessRecord;
