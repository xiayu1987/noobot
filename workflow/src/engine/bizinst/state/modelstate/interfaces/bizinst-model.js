/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../../interfaces/can-persistence');
var IState = require('../../interfaces/state');

class IBizinstModel {
  setState(state) {}
  getState() {}
  setActionNodeStates(actionNodeStates) {}
  getActionNodeStates() {}
  setCompositeNodeStates(compositeNodeStates) {}
  getCompositeNodeStates() {}
  setStateNodeStates(stateNodeStates) {}
  getStateNodeStates() {}
  setFlowtoStates(flowtoStates) {}
  getFlowtoStates() {}
  setPathStates(pathStates) {}
  getPathStates() {}
}

module.exports = IBizinstModel;
