/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICanPersistence from '../../../../interfaces/can-persistence.js';
import IBizinst from '../../interfaces/bizinst.js';
import ICurrentState from '../currentstate/interfaces/current-state.js';
import IBizinstModel from '../modelstate/interfaces/bizinst-model.js';

class IState {
  setBizinst(bizinst) {}
  getBizinst() {}
  setBizinstModel(bizinstModel) {}
  getBizinstModel() {}
  setCurrentState(currentState) {}
  getCurrentState() {}
}

export default  IState;
