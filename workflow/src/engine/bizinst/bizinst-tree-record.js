/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../can-persistence-base');

class BizinstTreeRecord extends CanPersistenceBase {
  constructor() {
    super();
    this.bizinst = null;
    this.actionRecords = null;
    this.actionRecords = [];
  }
  setRootBizinst(bizinst) {
    this.bizinst = bizinst;
  }
  getRootBizinst() {
    return this.bizinst;
  }
  setActionRecords(actionRecords) {
    this.actionRecords = actionRecords;
  }
  getActionRecords() {
    return this.actionRecords;
  }
}

module.exports = BizinstTreeRecord;
