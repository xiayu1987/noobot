/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../../../interfaces/bizinst');
var IProcess = require('../../../state/interfaces/process');
var IActionNodeStateProcess = require('../../../state/proc/fschange/interfaces/action-node-state-process');
var ICompositeNodeStateProcess = require('../../../state/proc/fschange/interfaces/composite-node-state-process');
var IDiscoverModelStateProcess = require('../../../state/proc/fschange/interfaces/discover-model-state-process');
var IPathStateProcess = require('../../../state/proc/fschange/interfaces/path-state-process');
var IStateNodeStateProcess = require('../../../state/proc/fschange/interfaces/state-node-state-process');
var IAddStepStateProcess = require('../../../state/proc/mschange/interfaces/add-step-state-process');

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

module.exports = IBizinstBox;
