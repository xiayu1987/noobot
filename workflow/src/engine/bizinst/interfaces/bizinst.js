/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICanPersistence from '../../../interfaces/can-persistence.js';
import IModel from '../../../design/model/interfaces/model.js';
import IProcessChain from '../state/interfaces/process-chain.js';
import IState from '../state/interfaces/state.js';

class IBizinst {
  setBusiness(business) {}
  getBusiness() {}
  setModel(model) {}
  getModel() {}
  setParentBizinst(bizinst) {}
  getParentBizinst() {}
  setChildBizinsts(childBizinsts) {}
  getChildBizinsts() {}
  setProcessChain(processChain) {}
  getProcessChain() {}
  setState(state) {}
  getState() {}
  setBizinstRunState(bizinstRunState) {}
  getBizinstRunState() {}
}

export default  IBizinst;
