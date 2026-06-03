/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../can-persistence-base.js';
import ICurrentState from './state/currentstate/interfaces/current-state.js';

class CurrentStateRecord extends CanPersistenceBase {
  constructor() {
    super();
    this.currentState = null;
    this.bizinst = null;
  }
  setCurrentState(currentState) {
    this.currentState = currentState;
  }
  getCurrentState() {
    return this.currentState;
  }
  setBizinst(bizinst) {
    this.bizinst = bizinst;
  }
  getBizinst() {
    return this.bizinst;
  }
}

export default  CurrentStateRecord;
