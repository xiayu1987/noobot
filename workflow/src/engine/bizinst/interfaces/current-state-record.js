/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICanPersistence from '../../../interfaces/can-persistence.js';
import ICurrentState from '../state/currentstate/interfaces/current-state.js';

class ICurrentStateRecord {
  setCurrentState(currentState) {}
  getCurrentState() {}
  setBizinst(bizinst) {}
  getBizinst() {}
}

export default  ICurrentStateRecord;
