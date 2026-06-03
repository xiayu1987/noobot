/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../../interfaces/bizinst');
var IBizinstTreeRecord = require('../../interfaces/bizinst-tree-record');
var BizinstBox = require('./bizinst-box');
var BizinstTreeBox = require('./bizinst-tree-box');

class BizinstBoxFactory {
  constructor() {}
  static getInstance() {
    if (!BizinstBoxFactory.instance) BizinstBoxFactory.instance = new BizinstBoxFactory();
    return BizinstBoxFactory.instance;
  }
  getBizinstBox(bizinst) {
    const result = new BizinstBox();
    result.setBizinst(bizinst);
    return result;
  }
  getBizinstTreeBox(bizinst, bizinstTreeRecord) {
    const result = new BizinstTreeBox();
    result.setBizinst(bizinst);
    result.setBizinstTreeRecord(bizinstTreeRecord);
    return result;
  }
}
BizinstBoxFactory.instance = new BizinstBoxFactory();

module.exports = BizinstBoxFactory;
