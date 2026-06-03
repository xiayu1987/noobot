/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IModel from '../../../design/model/interfaces/model.js';
import IActionRecord from '../../bizinst/interfaces/action-record.js';
import IBizinst from '../../bizinst/interfaces/bizinst.js';
import IBizinstTreeRecord from '../../bizinst/interfaces/bizinst-tree-record.js';
import IBusiness from '../../bizinst/interfaces/business.js';
import IAction from '../../bizinst/action/interfaces/action.js';
import IStepState from '../../bizinst/state/modelstate/interfaces/step-state.js';
import FlowException from '../../exception/flow-exception.js';

class IBizinstTreeControlCenter {
  startBizinst(business, model) {}
  execAction(action, bizinst, stepState, bizinstTreeRecord) {}
}

export default  IBizinstTreeControlCenter;
