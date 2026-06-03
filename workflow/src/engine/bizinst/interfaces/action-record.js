/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICanPersistence from '../../../interfaces/can-persistence.js';
import IAction from '../action/interfaces/action.js';

class IActionRecord {
  setAction(action) {}
  getAction() {}
  setSort(sort) {}
  getSort() {}
  setProcessRecords(processRecords) {}
  getProcessRecords() {}
}

export default  IActionRecord;
