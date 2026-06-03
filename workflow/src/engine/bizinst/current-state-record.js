/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../can-persistence-base');
var ICurrentState = require('./state/currentstate/interfaces/current-state');

class CurrentStateRecord extends CanPersistenceBase {
  constructor() {
    super();
    this.currentState = null;
    this.bizinst = null;
  }
  setCurrentState(currentState) {
    this.currentState = currentState;
  }
  getCurrentState() {
    return this.currentState;
  }
  setBizinst(bizinst) {
    this.bizinst = bizinst;
  }
  getBizinst() {
    return this.bizinst;
  }
}

module.exports = CurrentStateRecord;
