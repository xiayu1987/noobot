/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var EModelStateType = require('../../modelstate/enums/model-state-type');
var IModelState = require('../../modelstate/interfaces/model-state');

class NoteInfo {
  constructor() {
    this.modelStateType = null;
    this.handleWay = null;
    this.modelState = null;
  }
  getModelStateType() {
    return this.modelStateType;
  }
  setModelStateType(modelStateType) {
    this.modelStateType = modelStateType;
  }
  getHandleWay() {
    return this.handleWay;
  }
  setHandleWay(handleWay) {
    this.handleWay = handleWay;
  }
  getModelState() {
    return this.modelState;
  }
  setModelState(modelState) {
    this.modelState = modelState;
  }
}

module.exports = NoteInfo;
