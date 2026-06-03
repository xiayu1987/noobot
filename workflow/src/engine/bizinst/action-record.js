/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../can-persistence-base.js';
import IAction from './action/interfaces/action.js';

class ActionRecord extends CanPersistenceBase {
  constructor() {
    super();
    this.action = null;
    this.sort = null;
    this.processRecords = null;
  }
  setAction(action) {
    this.action = action;
  }
  getAction() {
    return this.action;
  }
  setSort(sort) {
    this.sort = sort;
  }
  getSort() {
    return this.sort;
  }
  setProcessRecords(processRecords) {
    this.processRecords = processRecords;
  }
  getProcessRecords() {
    return this.processRecords;
  }
}

export default  ActionRecord;
