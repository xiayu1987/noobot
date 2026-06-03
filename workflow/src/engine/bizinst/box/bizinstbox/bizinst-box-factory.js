/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IBizinst from '../../interfaces/bizinst.js';
import IBizinstTreeRecord from '../../interfaces/bizinst-tree-record.js';
import BizinstBox from './bizinst-box.js';
import BizinstTreeBox from './bizinst-tree-box.js';

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

export default  BizinstBoxFactory;
