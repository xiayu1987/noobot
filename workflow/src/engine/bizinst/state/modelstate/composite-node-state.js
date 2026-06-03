/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICompositeNode = require('../../../../design/model/node/interfaces/composite-node');
var IBizinst = require('../../interfaces/bizinst');
var NodeStateBase = require('./node-state-base');

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

module.exports = CompositeNodeState;
