/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../../interfaces/can-persistence');
var IStateNodeState = require('../../modelstate/interfaces/state-node-state');
var IStepState = require('../../modelstate/interfaces/step-state');

class ICurrentState {
  setCurrentStateSourceType(currentStateSourceType) {}
  getCurrentStateSourceType() {}
  setSourceInfo(sourceInfo) {}
  getSourceInfo() {}
  setSourceInfoSource(sourceInfoSource) {}
  getSourceInfoSource() {}
  setCurrentStepStates(currentStepStates) {}
  getCurrentStepStates() {}
  setStateNodeStates(stateNodeStates) {}
  getStateNodeStates() {}
}

module.exports = ICurrentState;
