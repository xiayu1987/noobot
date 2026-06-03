/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import EModelStateType from '../../modelstate/enums/model-state-type.js';
import IModelState from '../../modelstate/interfaces/model-state.js';

class DiscoverModelStateProcess {
  constructor() {
  }
  getModelState() {
    return this.modelState;
  }
  setModelState(modelState) {
    this.modelState = modelState;
  }
  getModelStateType() {
    return this.modelStateType;
  }
  setModelStateType(modelStateType) {
    this.modelStateType = modelStateType;
  }
}

export default  DiscoverModelStateProcess;
