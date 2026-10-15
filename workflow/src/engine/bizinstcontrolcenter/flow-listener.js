/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import EModelStateType from "../bizinst/state/modelstate/enums/model-state-type.js";
import ActionNodeStateProcess from "../bizinst/state/proc/fschange/action-node-state-process.js";
import CompositeNodeStateProcess from "../bizinst/state/proc/fschange/composite-node-state-process.js";
import DiscoverModelStateProcess from "../bizinst/state/proc/fschange/discover-model-state-process.js";
import EActionNodeStateProcessHandleWay from "../bizinst/state/proc/fschange/enums/action-node-state-process-handle-way.js";
import ECompositeNodeStateProcessHandleWay from "../bizinst/state/proc/fschange/enums/composite-node-state-process-handle-way.js";
import EStateNodeStateProcessHandleWay from "../bizinst/state/proc/fschange/enums/state-node-state-process-handle-way.js";
import PathStateProcess from "../bizinst/state/proc/fschange/path-state-process.js";
import StateNodeStateProcess from "../bizinst/state/proc/fschange/state-node-state-process.js";
import { text } from "@noobot/shared/value";

function isWorkflowVerboseLogEnabled() {
  const raw = text(process?.env?.NOOBOT_WORKFLOW_VERBOSE_LOG).toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

class FlowListener {
  constructor() {
    this.bizinstTreeBox = null;
    this.verboseLogEnabled = isWorkflowVerboseLogEnabled();
  }

  logVerbose(message = "") {
    if (!this.verboseLogEnabled) return;
    console.log(String(message || ""));
  }

  getBizinstTreeBox() {
    return this.bizinstTreeBox;
  }

  setBizinstTreeBox(bizinstTreeBox) {
    this.bizinstTreeBox = bizinstTreeBox;
  }

  getRealTimeProcess(bizinst) {
    return this.bizinstTreeBox.getRealTimeProcess(bizinst);
  }

  discoverModelState(bizinst, modelState) {
    let modelStateType = EModelStateType.ActionNodeState;

    if (modelState && typeof modelState.getFlowto === "function") {
      this.logVerbose("Discovered flowto state: " + modelState.getFlowto().getName());
      modelStateType = EModelStateType.FlowtoState;
    } else if (modelState && typeof modelState.getBizinst === "function") {
      this.logVerbose("Discovered composite node state: " + modelState.getNode().getName());
      modelStateType = EModelStateType.CompositeNodeState;
    } else if (modelState && typeof modelState.getStepStates === "function") {
      this.logVerbose("Discovered action node state: " + modelState.getNode().getName());
      modelStateType = EModelStateType.ActionNodeState;
    } else {
      this.logVerbose("Discovered state node state: " + modelState.getNode().getName());
      modelStateType = EModelStateType.StateNodeState;
    }

    const process = new DiscoverModelStateProcess();
    process.setModelState(modelState);
    process.setModelStateType(modelStateType);

    this.getRealTimeProcess(bizinst)
      .getFlowProcess()
      .getDiscoverModelStateProcesses()
      .push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  goThrough(bizinst, pathState, direction) {
    this.logVerbose(
      "Passed " +
        (direction === 1 ? "(forward)" : "(backward)") +
        " path: " +
        pathState.getStartNodeState().getNode().getName() +
        "----" +
        pathState.getFlowtoState().getFlowto().getName() +
        "---->" +
        pathState.getEndNodeState().getNode().getName(),
    );

    const process = new PathStateProcess();
    process.setPathState(pathState);
    process.setDirection(direction);
    this.getRealTimeProcess(bizinst).getFlowProcess().getPathStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  arriveStepState(bizinst, stepState) {
    this.logVerbose(
      "Arrived at step: " +
        stepState.getActionNodeState().getNode().getName() +
        " step #" +
        stepState.getActionNodeState().getStepStates().indexOf(stepState),
    );

    const process = new ActionNodeStateProcess();
    process.setNodeState(stepState.getActionNodeState());
    process.setStepState(stepState);
    process.setActionNodeStateProcessHandleWay(EActionNodeStateProcessHandleWay.Arrive);
    this.getRealTimeProcess(bizinst).getFlowProcess().getActionNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  handleStepState(bizinst, stepState) {
    this.logVerbose(
      "Handled step: " +
        stepState.getActionNodeState().getNode().getName() +
        " step #" +
        stepState.getActionNodeState().getStepStates().indexOf(stepState),
    );

    const process = new ActionNodeStateProcess();
    process.setNodeState(stepState.getActionNodeState());
    process.setStepState(stepState);
    process.setActionNodeStateProcessHandleWay(EActionNodeStateProcessHandleWay.Handle);
    this.getRealTimeProcess(bizinst).getFlowProcess().getActionNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  stop(bizinst, stepState) {
    this.logVerbose("Instance stopped");
    const process = new ActionNodeStateProcess();
    process.setNodeState(stepState.getActionNodeState());
    process.setStepState(stepState);
    process.setActionNodeStateProcessHandleWay(EActionNodeStateProcessHandleWay.Stop);
    this.getRealTimeProcess(bizinst).getFlowProcess().getActionNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  startChildBizinst(bizinst, compositeNodeState) {
    this.logVerbose("Started child instance: " + compositeNodeState.getNode().getName());
    const process = new CompositeNodeStateProcess();
    process.setNodeState(compositeNodeState);
    process.setChildBizinst(compositeNodeState.getBizinst());
    process.setCompositeNodeStateProcessHandleWay(
      ECompositeNodeStateProcessHandleWay.startChildBizinst,
    );
    this.getRealTimeProcess(bizinst)
      .getFlowProcess()
      .getCompositeNodeStateProcesses()
      .push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  openChildBizinst(bizinst, compositeNodeState) {
    this.logVerbose("Opened child instance: " + compositeNodeState.getNode().getName());
    const process = new CompositeNodeStateProcess();
    process.setNodeState(compositeNodeState);
    process.setChildBizinst(compositeNodeState.getBizinst());
    process.setCompositeNodeStateProcessHandleWay(
      ECompositeNodeStateProcessHandleWay.openChildBizinst,
    );
    this.getRealTimeProcess(bizinst)
      .getFlowProcess()
      .getCompositeNodeStateProcesses()
      .push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  noticeParentBizinst(
    parentBizinst,
    childBizinst,
    compositeNodeState,
    routeNoteInfo,
    sourceNoteInfo,
  ) {
    this.logVerbose("Notified parent instance");
    const process = new CompositeNodeStateProcess();
    process.setNodeState(compositeNodeState);
    process.setChildBizinst(compositeNodeState.getBizinst());
    process.setCompositeNodeStateProcessHandleWay(
      ECompositeNodeStateProcessHandleWay.noticeParentBizinst,
    );
    process.setRouteNoteInfo(routeNoteInfo);
    process.setSourceNoteInfo(sourceNoteInfo);
    this.getRealTimeProcess(parentBizinst)
      .getFlowProcess()
      .getCompositeNodeStateProcesses()
      .push(process);
    this.bizinstTreeBox.saveState(parentBizinst, process);
  }

  start(bizinst, stateNodeState) {
    const process = new StateNodeStateProcess();
    process.setNodeState(stateNodeState);
    process.setStateNodeStateProcessHandleWay(EStateNodeStateProcessHandleWay.start);
    this.getRealTimeProcess(bizinst).getFlowProcess().getStateNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  open(bizinst, stateNodeState) {
    const process = new StateNodeStateProcess();
    process.setNodeState(stateNodeState);
    process.setStateNodeStateProcessHandleWay(EStateNodeStateProcessHandleWay.open);
    this.getRealTimeProcess(bizinst).getFlowProcess().getStateNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  end(bizinst, stateNodeState) {
    const process = new StateNodeStateProcess();
    process.setNodeState(stateNodeState);
    process.setStateNodeStateProcessHandleWay(EStateNodeStateProcessHandleWay.end);
    this.getRealTimeProcess(bizinst).getFlowProcess().getStateNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  close(bizinst, stateNodeState) {
    const process = new StateNodeStateProcess();
    process.setNodeState(stateNodeState);
    process.setStateNodeStateProcessHandleWay(EStateNodeStateProcessHandleWay.close);
    this.getRealTimeProcess(bizinst).getFlowProcess().getStateNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  forwardStateNodeStateChange(bizinst, stateNodeState) {
    const process = new StateNodeStateProcess();
    process.setNodeState(stateNodeState);
    process.setStateNodeStateProcessHandleWay(EStateNodeStateProcessHandleWay.forwardStateChange);
    this.getRealTimeProcess(bizinst).getFlowProcess().getStateNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  backwardStateNodeStateChange(bizinst, stateNodeState) {
    const process = new StateNodeStateProcess();
    process.setNodeState(stateNodeState);
    process.setStateNodeStateProcessHandleWay(EStateNodeStateProcessHandleWay.backwardStateChange);
    this.getRealTimeProcess(bizinst).getFlowProcess().getStateNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  takePartInStateChange(bizinst, stateNodeState) {
    const process = new StateNodeStateProcess();
    process.setNodeState(stateNodeState);
    process.setStateNodeStateProcessHandleWay(EStateNodeStateProcessHandleWay.takePartIn);
    this.getRealTimeProcess(bizinst).getFlowProcess().getStateNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }
}

export default FlowListener;
