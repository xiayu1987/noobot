/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class IFlowListener {
  discoverModelState(bizinst, modelState) {}
  goThrough(bizinst, pathState, direction) {}
  arriveStepState(bizinst, stepState) {}
  handleStepState(bizinst, stepState) {}
  stop(bizinst, stepState) {}
  startChildBizinst(bizinst, compositeNodeState) {}
  openChildBizinst(bizinst, compositeNodeState) {}
  noticeParentBizinst(
    parentBizinst,
    childBizinst,
    compositeNodeState,
    routeNoteInfo,
    sourceNoteInfo,
  ) {}
  start(bizinst, stateNodeState) {}
  end(bizinst, stateNodeState) {}
  open(bizinst, stateNodeState) {}
  close(bizinst, stateNodeState) {}
  forwardStateNodeStateChange(bizinst, stateNodeState) {}
  backwardStateNodeStateChange(bizinst, stateNodeState) {}
  takePartInStateChange(bizinst, stateNodeState) {}
}

export default IFlowListener;
