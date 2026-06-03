/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../can-persistence-base.js';
import IBizinst from '../interfaces/bizinst.js';
import CurrentState from './currentstate/current-state.js';
import ICurrentState from './currentstate/interfaces/current-state.js';
import IBizinstModel from './modelstate/interfaces/bizinst-model.js';
import BizinstModel from './modelstate/bizinst-model.js';

class State extends CanPersistenceBase {
  constructor() {
    super();
    this.bizinstModel = null;
    this.currentState = null;
    this.bizinst = null;
    this.bizinstModel = new BizinstModel();
    this.bizinstModel.setState(this);
    this.currentState = new CurrentState();
  }
  setBizinstModel(bizinstModel) {
    this.bizinstModel = bizinstModel;
  }
  getBizinstModel() {
    return this.bizinstModel;
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

export default  State;
