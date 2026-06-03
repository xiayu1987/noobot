/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IStepState = require('../../state/modelstate/interfaces/step-state');

class StepStateBox {
  constructor() {
    this.stepState = null;
  }
  setStepState(stepState) {
    this.stepState = stepState;
  }
  getStepState() {
    return this.stepState;
  }
  getPreStepState() {
    const stepStates = this.getStepState().getActionNodeState().getStepStates();
    const idx = stepStates.indexOf(this.stepState);
    if (idx <= 0) return null;
    return stepStates[idx - 1];
  }
  getNextStepState() {
    const stepStates = this.getStepState().getActionNodeState().getStepStates();
    const idx = stepStates.indexOf(this.stepState);
    if (idx >= stepStates.length - 1) return null;
    return stepStates[idx + 1];
  }
}

module.exports = StepStateBox;
