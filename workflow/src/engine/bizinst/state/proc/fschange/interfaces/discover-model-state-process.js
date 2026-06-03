/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import EModelStateType from '../../../modelstate/enums/model-state-type.js';
import IModelState from '../../../modelstate/interfaces/model-state.js';

class IDiscoverModelStateProcess {
  getModelState() {}
  setModelState(modelState) {}
  getModelStateType() {}
  setModelStateType(modelStateType) {}
}

export default  IDiscoverModelStateProcess;
