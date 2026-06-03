/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../../../can-persistence-base.js';
import IActionNodeState from '../../modelstate/interfaces/action-node-state.js';
import IStepState from '../../modelstate/interfaces/step-state.js';

class AddStepStateProcess extends CanPersistenceBase {
  constructor() {
    super();
    this.actionNodeState = null;
    this.stepState = null;
    this.handleStepState = null;
    this.index = null;
  }
  setActionNodeState(actionNodeState) {
    this.actionNodeState = actionNodeState;
  }
  getActionNodeState() {
    return this.actionNodeState;
  }
  setStepState(stepState) {
    this.stepState = stepState;
  }
  getStepState() {
    return this.stepState;
  }
  setIndex(index) {
    this.index = index;
  }
  getIndex() {
    return this.index;
  }
  setHandleStepState(handleStepState) {
    this.handleStepState = handleStepState;
  }
  getHandleStepState() {
    return this.handleStepState;
  }
}

export default  AddStepStateProcess;
