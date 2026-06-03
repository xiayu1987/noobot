/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IBizinst from '../../../interfaces/bizinst.js';
import IProcess from '../../../state/interfaces/process.js';
import IActionNodeStateProcess from '../../../state/proc/fschange/interfaces/action-node-state-process.js';
import ICompositeNodeStateProcess from '../../../state/proc/fschange/interfaces/composite-node-state-process.js';
import IDiscoverModelStateProcess from '../../../state/proc/fschange/interfaces/discover-model-state-process.js';
import IPathStateProcess from '../../../state/proc/fschange/interfaces/path-state-process.js';
import IStateNodeStateProcess from '../../../state/proc/fschange/interfaces/state-node-state-process.js';
import IAddStepStateProcess from '../../../state/proc/mschange/interfaces/add-step-state-process.js';

class IBizinstBox {
  setBizinst(bizinst) {}
  getBizinst() {}
  getRealTimeProcess() {}
  resetRealTimeProcess() {}
  saveState(actionNodeStateProcess) {}
  saveState(compositeNodeStateProcess) {}
  saveState(stateNodeStateProcess) {}
  saveState(discoverModelStateProcess) {}
  saveState(pathStateProcess) {}
  saveState(addStepStateProcess) {}
  saveProcess() {}
}

export default  IBizinstBox;
