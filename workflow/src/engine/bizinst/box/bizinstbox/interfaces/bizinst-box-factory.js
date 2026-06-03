/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../../../interfaces/bizinst');
var IBizinstTreeRecord = require('../../../interfaces/bizinst-tree-record');

class IBizinstBoxFactory {
  getBizinstBox(bizinst) {}
  getBizinstTreeBox(bizinst, bizinstTreeRecord) {}
}

module.exports = IBizinstBoxFactory;
