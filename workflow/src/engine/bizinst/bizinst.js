/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../can-persistence-base');
var IModel = require('../../design/model/interfaces/model');
var IProcessChain = require('./state/interfaces/process-chain');
var IState = require('./state/interfaces/state');

class Bizinst extends CanPersistenceBase {
  constructor() {
    super();
    this.business = null;
    this.model = null;
    this.parentBizinst = null;
    this.childBizinsts = null;
    this.processChain = null;
    this.state = null;
    this.bizinstRunState = null;
    this.childBizinsts = [];
  }
  setBusiness(business) {
    this.business = business;
  }
  getBusiness() {
    return this.business;
  }
  setModel(model) {
    this.model = model;
  }
  getModel() {
    return this.model;
  }
  setParentBizinst(bizinst) {
    this.parentBizinst = bizinst;
  }
  getParentBizinst() {
    return this.parentBizinst;
  }
  setChildBizinsts(childBizinsts) {
    this.childBizinsts = childBizinsts;
  }
  getChildBizinsts() {
    return this.childBizinsts;
  }
  setProcessChain(processChain) {
    this.processChain = processChain;
  }
  getProcessChain() {
    return this.processChain;
  }
  setState(state) {
    this.state = state;
  }
  getState() {
    return this.state;
  }
  setBizinstRunState(bizinstRunState) {
    this.bizinstRunState = bizinstRunState;
  }
  getBizinstRunState() {
    return this.bizinstRunState;
  }
}

module.exports = Bizinst;
