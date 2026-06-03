/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IStepState from '../../../state/modelstate/interfaces/step-state.js';

class IStepStateBox {
  setStepState(stepState) {}
  getStepState() {}
  getPreStepState() {}
  getNextStepState() {}
}

export default  IStepStateBox;
