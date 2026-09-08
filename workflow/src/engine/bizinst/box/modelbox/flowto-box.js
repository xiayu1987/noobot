/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import FlowtoState from "../../state/modelstate/flowto-state.js";

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

export default FlowtoBox;
