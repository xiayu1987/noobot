/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../../can-persistence-base');
var EFlowDirection = require('../../enums/flow-direction');
var IStateNodeState = require('../modelstate/interfaces/state-node-state');
var IStepState = require('../modelstate/interfaces/step-state');

class CurrentState extends CanPersistenceBase {
  constructor() {
    super();
    this.currentStateSourceType = null;
    this.sourceInfo = null;
    this.sourceInfoSource = null;
    this.currentStepStates = null;
    this.stateNodeStates = null;
    this.currentStepStates = [];
    this.stateNodeStates = [];
  }
  setCurrentStateSourceType(currentStateSourceType) {
    this.currentStateSourceType = currentStateSourceType;
  }
  getCurrentStateSourceType() {
    return this.currentStateSourceType;
  }
  setCurrentStepStates(currentStepStates) {
    this.currentStepStates = currentStepStates;
  }
  getCurrentStepStates() {
    return this.currentStepStates;
  }
  setStateNodeStates(stateNodeStates) {
    this.stateNodeStates = stateNodeStates;
  }
  getStateNodeStates() {
    return this.stateNodeStates;
  }
  setSourceInfo(sourceInfo) {
    this.sourceInfo = sourceInfo;
  }
  getSourceInfo() {
    return this.sourceInfo;
  }
  setSourceInfoSource(sourceInfoSource) {
    this.sourceInfoSource = sourceInfoSource;
  }
  getSourceInfoSource() {
    return this.sourceInfoSource;
  }
}

module.exports = CurrentState;
