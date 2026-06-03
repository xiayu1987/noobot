/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var EModelStateType = require('../modelstate/enums/model-state-type');
var IModelState = require('../modelstate/interfaces/model-state');

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

module.exports = SourceInfo;
