/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICompositeNode from '../../../../design/model/node/interfaces/composite-node.js';
import IBizinst from '../../interfaces/bizinst.js';
import NodeStateBase from './node-state-base.js';

class CompositeNodeState extends NodeStateBase {
  constructor() {
    super();
    this.bizinst = null;
  }
  setBizinst(bizinst) {
    this.bizinst = bizinst;
  }
  getBizinst() {
    return this.bizinst;
  }
}

export default  CompositeNodeState;
