/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IActionRecord from '../bizinst/interfaces/action-record.js';
import IBizinst from '../bizinst/interfaces/bizinst.js';
import IBizinstTreeRecord from '../bizinst/interfaces/bizinst-tree-record.js';

class StartBizinstInfo {
  constructor() {
    this.bizinst = null;
    this.actionRecord = null;
    this.bizinstTreeRecord = null;
  }
  getBizinst() {
    return this.bizinst;
  }
  setBizinst(bizinst) {
    this.bizinst = bizinst;
  }
  getActionRecord() {
    return this.actionRecord;
  }
  setActionRecord(actionRecord) {
    this.actionRecord = actionRecord;
  }
  getBizinstTreeRecord() {
    return this.bizinstTreeRecord;
  }
  setBizinstTreeRecord(bizinstTreeRecord) {
    this.bizinstTreeRecord = bizinstTreeRecord;
  }
}

export default  StartBizinstInfo;
