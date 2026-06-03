/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IBizinst from '../interfaces/bizinst.js';
import IStepState from '../state/modelstate/interfaces/step-state.js';
import BizinstFlowEngine from '../../bizinstcontrolcenter/bizinst-flow-engine.js';
import IFlowListener from '../../bizinstcontrolcenter/interfaces/flow-listener.js';
import FlowException from '../../exception/flow-exception.js';
import ActionBase from './action-base.js';

class BackAction extends ActionBase {
  constructor() {
    super();
  }
  getName() {
    return "退回";
  }
  exec(bizinst, stepState, flowListener) {
    BizinstFlowEngine.getInstance().goPre(bizinst, stepState, flowListener);
  }
}

export default  BackAction;
