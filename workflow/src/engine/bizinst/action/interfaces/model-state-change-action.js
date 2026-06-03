/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IBizinst from '../../interfaces/bizinst.js';
import IStepState from '../../state/modelstate/interfaces/step-state.js';
import IModelStateListener from '../../../bizinstcontrolcenter/interfaces/model-state-listener.js';

class IModelStateChangeAction {
  exec(bizinst, currentStepState, modelStateListener) {}
}

export default  IModelStateChangeAction;
