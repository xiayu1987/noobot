/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var EModelStateType = require('../../../modelstate/enums/model-state-type');
var IModelState = require('../../../modelstate/interfaces/model-state');

class IDiscoverModelStateProcess {
  getModelState() {}
  setModelState(modelState) {}
  getModelStateType() {}
  setModelStateType(modelStateType) {}
}

module.exports = IDiscoverModelStateProcess;
