/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IBizinst = require('../../bizinst/interfaces/bizinst');
var ICompositeNodeState = require('../../bizinst/state/modelstate/interfaces/composite-node-state');
var IModelState = require('../../bizinst/state/modelstate/interfaces/model-state');
var IPathState = require('../../bizinst/state/modelstate/interfaces/path-state');
var IStateNodeState = require('../../bizinst/state/modelstate/interfaces/state-node-state');
var IStepState = require('../../bizinst/state/modelstate/interfaces/step-state');
var NoteInfo = require('../../bizinst/state/proc/fschange/note-info');

class IFlowListener {
  discoverModelState(bizinst, modelState) {}
  goThrough(bizinst, pathState, direction) {}
  arriveStepState(bizinst, stepState) {}
  handleStepState(bizinst, stepState) {}
  stop(bizinst, stepState) {}
  startChildBizinst(bizinst, compositeNodeState) {}
  openChildBizinst(bizinst, compositeNodeState) {}
  noticeParentBizinst(parentBizinst, childBizinst, compositeNodeState, routeNoteInfo, sourceNoteInfo) {}
  start(bizinst, stateNodeState) {}
  end(bizinst, stateNodeState) {}
  open(bizinst, stateNodeState) {}
  close(bizinst, stateNodeState) {}
  forwardStateNodeStateChange(bizinst, stateNodeState) {}
  backwardStateNodeStateChange(bizinst, stateNodeState) {}
  takePartInStateChange(bizinst, stateNodeState) {}
}

module.exports = IFlowListener;
