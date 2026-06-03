/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../can-persistence-base');
var IBizinst = require('../interfaces/bizinst');
var CurrentState = require('./currentstate/current-state');
var ICurrentState = require('./currentstate/interfaces/current-state');
var IBizinstModel = require('./modelstate/interfaces/bizinst-model');
var BizinstModel = require('./modelstate/bizinst-model');

class State extends CanPersistenceBase {
  constructor() {
    super();
    this.bizinstModel = null;
    this.currentState = null;
    this.bizinst = null;
    this.bizinstModel = new BizinstModel();
    this.bizinstModel.setState(this);
    this.currentState = new CurrentState();
  }
  setBizinstModel(bizinstModel) {
    this.bizinstModel = bizinstModel;
  }
  getBizinstModel() {
    return this.bizinstModel;
  }
  setCurrentState(currentState) {
    this.currentState = currentState;
  }
  getCurrentState() {
    return this.currentState;
  }
  setBizinst(bizinst) {
    this.bizinst = bizinst;
  }
  getBizinst() {
    return this.bizinst;
  }
}

module.exports = State;
