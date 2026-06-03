/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../interfaces/can-persistence');
var ICurrentState = require('../state/currentstate/interfaces/current-state');

class ICurrentStateRecord {
  setCurrentState(currentState) {}
  getCurrentState() {}
  setBizinst(bizinst) {}
  getBizinst() {}
}

module.exports = ICurrentStateRecord;
