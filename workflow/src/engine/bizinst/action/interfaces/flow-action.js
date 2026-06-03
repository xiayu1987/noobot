/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IBizinst from '../../interfaces/bizinst.js';
import IStepState from '../../state/modelstate/interfaces/step-state.js';
import IFlowListener from '../../../bizinstcontrolcenter/interfaces/flow-listener.js';
import FlowException from '../../../exception/flow-exception.js';

class IFlowAction {
  exec(bizinst, stepState, flowListener) {}
}

export default  IFlowAction;
