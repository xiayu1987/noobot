/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IBizinst from '../../bizinst/interfaces/bizinst.js';
import ICompositeNodeState from '../../bizinst/state/modelstate/interfaces/composite-node-state.js';
import IModelState from '../../bizinst/state/modelstate/interfaces/model-state.js';
import IPathState from '../../bizinst/state/modelstate/interfaces/path-state.js';
import IStateNodeState from '../../bizinst/state/modelstate/interfaces/state-node-state.js';
import IStepState from '../../bizinst/state/modelstate/interfaces/step-state.js';
import NoteInfo from '../../bizinst/state/proc/fschange/note-info.js';

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

export default  IFlowListener;
