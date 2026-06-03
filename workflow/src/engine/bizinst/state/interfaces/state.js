/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../interfaces/can-persistence');
var IBizinst = require('../../interfaces/bizinst');
var ICurrentState = require('../currentstate/interfaces/current-state');
var IBizinstModel = require('../modelstate/interfaces/bizinst-model');

class IState {
  setBizinst(bizinst) {}
  getBizinst() {}
  setBizinstModel(bizinstModel) {}
  getBizinstModel() {}
  setCurrentState(currentState) {}
  getCurrentState() {}
}

module.exports = IState;
