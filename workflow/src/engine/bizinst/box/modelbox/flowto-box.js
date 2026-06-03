/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IFlowto from '../../../../design/model/flowto/interfaces/flowto.js';
import IBizinst from '../../interfaces/bizinst.js';
import FlowtoState from '../../state/modelstate/flowto-state.js';
import IFlowtoState from '../../state/modelstate/interfaces/flowto-state.js';
import IBizinstModel from '../../state/modelstate/interfaces/bizinst-model.js';

class FlowtoBox {
  constructor() {
    this.flowto = null;
  }
  setFlowto(flowto) {
    this.flowto = flowto;
  }
  getFlowto() {
    return this.flowto;
  }
  canFlow(bizinst) {
    return true;
  }
  createFlowtoState(bizinstModel) {
    const result = new FlowtoState();
    result.setFlowto(this.getFlowto());
    result.setBizinstModel(bizinstModel);
    return result;
  }
}

export default  FlowtoBox;
