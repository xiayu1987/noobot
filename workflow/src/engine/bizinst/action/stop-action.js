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

class StopAction extends ActionBase {
  constructor() {
    super();
  }
  getName() {
    return "终止";
  }
  exec(bizinst, stepState, flowListener) {
    BizinstFlowEngine.getInstance().stopBizinst(bizinst, stepState, flowListener);
  }
}

export default  StopAction;
