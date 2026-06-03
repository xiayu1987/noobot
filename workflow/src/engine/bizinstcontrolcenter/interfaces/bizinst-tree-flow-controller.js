/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IFlowAction from '../../bizinst/action/interfaces/flow-action.js';
import IBizinstTreeBox from '../../bizinst/box/bizinstbox/interfaces/bizinst-tree-box.js';
import IStepState from '../../bizinst/state/modelstate/interfaces/step-state.js';
import FlowException from '../../exception/flow-exception.js';

class IBizinstTreeFlowControler {
  execAction(flowAction, bizinstTreeBox, stepState) {}
}

export default  IBizinstTreeFlowControler;
