/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import EModelStateType from '../modelstate/enums/model-state-type.js';
import IModelState from '../modelstate/interfaces/model-state.js';

class SourceInfo {
  constructor() {
    this.modelStateType = null;
    this.sourceHandleWay = null;
    this.modelState = null;
  }
  getModelStateType() {
    return this.modelStateType;
  }
  setModelStateType(modelStateType) {
    this.modelStateType = modelStateType;
  }
  getSourceHandleWay() {
    return this.sourceHandleWay;
  }
  setSourceHandleWay(sourceHandleWay) {
    this.sourceHandleWay = sourceHandleWay;
  }
  getModelState() {
    return this.modelState;
  }
  setModelState(modelState) {
    this.modelState = modelState;
  }
}

export default  SourceInfo;
