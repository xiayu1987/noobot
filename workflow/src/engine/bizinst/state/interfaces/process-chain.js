/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../interfaces/can-persistence');
var IBizinst = require('../../interfaces/bizinst');

class IProcessChain {
  setBizinst(bizinst) {}
  getBizinst() {}
  setProcesses(processes) {}
  getProcesses() {}
}

module.exports = IProcessChain;
