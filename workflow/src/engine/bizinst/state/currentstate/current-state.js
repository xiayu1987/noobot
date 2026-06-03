/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../../can-persistence-base.js';
import EFlowDirection from '../../enums/flow-direction.js';
import IStateNodeState from '../modelstate/interfaces/state-node-state.js';
import IStepState from '../modelstate/interfaces/step-state.js';

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

export default  CurrentState;
