/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IStepState = require('../../../state/modelstate/interfaces/step-state');

class IStepStateBox {
  setStepState(stepState) {}
  getStepState() {}
  getPreStepState() {}
  getNextStepState() {}
}

module.exports = IStepStateBox;
