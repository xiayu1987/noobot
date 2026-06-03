/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IModel from '../../../design/model/interfaces/model.js';
import IBizinst from '../../bizinst/interfaces/bizinst.js';
import IBusiness from '../../bizinst/interfaces/business.js';
import IStepState from '../../bizinst/state/modelstate/interfaces/step-state.js';
import FlowException from '../../exception/flow-exception.js';

class IBizinstFlowEngine {
  createBizinst(business, model) {}
  startBizinst(bizinst, flowListener) {}
  openBizinst(bizinst, flowListener) {}
  stopBizinst(bizinst, currentStepState, flowListener) {}
  goNext(bizinst, currentStepState, flowListener) {}
  goPre(bizinst, currentStepState, flowListener) {}
}

export default  IBizinstFlowEngine;
