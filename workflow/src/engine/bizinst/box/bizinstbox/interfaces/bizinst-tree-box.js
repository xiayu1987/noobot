/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../../../interfaces/bizinst');
var IBizinstTreeRecord = require('../../../interfaces/bizinst-tree-record');
var IAction = require('../../../action/interfaces/action');
var IProcess = require('../../../state/interfaces/process');
var IStepState = require('../../../state/modelstate/interfaces/step-state');
var IActionNodeStateProcess = require('../../../state/proc/fschange/interfaces/action-node-state-process');
var ICompositeNodeStateProcess = require('../../../state/proc/fschange/interfaces/composite-node-state-process');
var IDiscoverModelStateProcess = require('../../../state/proc/fschange/interfaces/discover-model-state-process');
var IPathStateProcess = require('../../../state/proc/fschange/interfaces/path-state-process');
var IStateNodeStateProcess = require('../../../state/proc/fschange/interfaces/state-node-state-process');
var IAddStepStateProcess = require('../../../state/proc/mschange/interfaces/add-step-state-process');

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

module.exports = IBizinstTreeBox;
