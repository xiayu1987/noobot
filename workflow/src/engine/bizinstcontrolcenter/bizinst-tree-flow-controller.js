/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IStartAction from '../bizinst/action/interfaces/start-action.js';
import IBizinstTreeBox from '../bizinst/box/bizinstbox/interfaces/bizinst-tree-box.js';
import IStepState from '../bizinst/state/modelstate/interfaces/step-state.js';
import FlowException from '../exception/flow-exception.js';
import FlowListener from './flow-listener.js';

class BizinstTreeFlowControler {
  constructor() {}

  execAction(flowAction, bizinstTreeBox, stepState) {
    const flowListener = new FlowListener();
    flowListener.setBizinstTreeBox(bizinstTreeBox);

    const isStartAction =
      flowAction instanceof IStartAction ||
      flowAction?.getName?.() === '开始' ||
      (flowAction && flowAction.constructor && flowAction.constructor.name === 'StartAction');

    if (isStartAction) {
      flowAction.exec(bizinstTreeBox.getRootBizinst(), null, flowListener);
    } else {
      flowAction.exec(bizinstTreeBox.getCurrentBizinst(stepState), stepState, flowListener);
    }
  }
}

export default BizinstTreeFlowControler;
