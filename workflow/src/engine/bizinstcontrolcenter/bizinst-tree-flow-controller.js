/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import FlowListener from "./flow-listener.js";

class BizinstTreeFlowControler {
  constructor() {}

  execAction(flowAction, bizinstTreeBox, stepState) {
    const flowListener = new FlowListener();
    flowListener.setBizinstTreeBox(bizinstTreeBox);

    if (flowAction.isStartAction()) {
      flowAction.exec(bizinstTreeBox.getRootBizinst(), null, flowListener);
    } else {
      flowAction.exec(bizinstTreeBox.getCurrentBizinst(stepState), stepState, flowListener);
    }
  }
}

export default BizinstTreeFlowControler;
