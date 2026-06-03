/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IBizinst from '../../../interfaces/bizinst.js';
import IBizinstTreeRecord from '../../../interfaces/bizinst-tree-record.js';
import IAction from '../../../action/interfaces/action.js';
import IProcess from '../../../state/interfaces/process.js';
import IStepState from '../../../state/modelstate/interfaces/step-state.js';
import IActionNodeStateProcess from '../../../state/proc/fschange/interfaces/action-node-state-process.js';
import ICompositeNodeStateProcess from '../../../state/proc/fschange/interfaces/composite-node-state-process.js';
import IDiscoverModelStateProcess from '../../../state/proc/fschange/interfaces/discover-model-state-process.js';
import IPathStateProcess from '../../../state/proc/fschange/interfaces/path-state-process.js';
import IStateNodeStateProcess from '../../../state/proc/fschange/interfaces/state-node-state-process.js';
import IAddStepStateProcess from '../../../state/proc/mschange/interfaces/add-step-state-process.js';

class IBizinstTreeBox {
  setBizinst(bizinst) {}
  getCurrentBizinst(stepState) {}
  getRootBizinst() {}
  setBizinstTreeRecord(bizinstTreeRecord) {}
  getBizinstTreeRecord() {}
  getRealTimeProcess(bizinst) {}
  saveState(bizinst, actionNodeStateProcess) {}
  saveState(bizinst, compositeNodeStateProcess) {}
  saveState(bizinst, stateNodeStateProcess) {}
  saveState(bizinst, discoverModelStateProcess) {}
  saveState(bizinst, pathStateProcess) {}
  saveState(bizinst, addStepStateProcess) {}
  saveProcess(action) {}
}

export default  IBizinstTreeBox;
