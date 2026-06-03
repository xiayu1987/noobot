/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var EModelStateType = require('../../modelstate/enums/model-state-type');
var IModelState = require('../../modelstate/interfaces/model-state');

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

module.exports = DiscoverModelStateProcess;
