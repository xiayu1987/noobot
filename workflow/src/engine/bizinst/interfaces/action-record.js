/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../interfaces/can-persistence');
var IAction = require('../action/interfaces/action');

class IActionRecord {
  setAction(action) {}
  getAction() {}
  setSort(sort) {}
  getSort() {}
  setProcessRecords(processRecords) {}
  getProcessRecords() {}
}

module.exports = IActionRecord;
