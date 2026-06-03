/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var EModelStateType = require('../bizinst/state/modelstate/enums/model-state-type');
var ActionNodeStateProcess = require('../bizinst/state/proc/fschange/action-node-state-process');
var CompositeNodeStateProcess = require('../bizinst/state/proc/fschange/composite-node-state-process');
var DiscoverModelStateProcess = require('../bizinst/state/proc/fschange/discover-model-state-process');
var EActionNodeStateProcessHandleWay = require('../bizinst/state/proc/fschange/enums/action-node-state-process-handle-way');
var ECompositeNodeStateProcessHandleWay = require('../bizinst/state/proc/fschange/enums/composite-node-state-process-handle-way');
var EStateNodeStateProcessHandleWay = require('../bizinst/state/proc/fschange/enums/state-node-state-process-handle-way');
var PathStateProcess = require('../bizinst/state/proc/fschange/path-state-process');
var StateNodeStateProcess = require('../bizinst/state/proc/fschange/state-node-state-process');

class FlowListener {
  constructor() {
    this.bizinstTreeBox = null;
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

    if (modelState && typeof modelState.getFlowto === 'function') {
      console.log('发现流向状态：' + modelState.getFlowto().getName());
      modelStateType = EModelStateType.FlowtoState;
    } else if (modelState && typeof modelState.getBizinst === 'function') {
      console.log('发现复合节点状态：' + modelState.getNode().getName());
      modelStateType = EModelStateType.CompositeNodeState;
    } else if (modelState && typeof modelState.getStepStates === 'function') {
      console.log('发现动作节点状态：' + modelState.getNode().getName());
      modelStateType = EModelStateType.ActionNodeState;
    } else {
      console.log('发现状态节点状态：' + modelState.getNode().getName());
      modelStateType = EModelStateType.StateNodeState;
    }

    const process = new DiscoverModelStateProcess();
    process.setModelState(modelState);
    process.setModelStateType(modelStateType);

    this.getRealTimeProcess(bizinst).getFlowProcess().getDiscoverModelStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  goThrough(bizinst, pathState, direction) {
    console.log(
      '经过' +
        (direction === 1 ? '(正向)' : '(反向)') +
        '路径：' +
        pathState.getStartNodeState().getNode().getName() +
        '----' +
        pathState.getFlowtoState().getFlowto().getName() +
        '---->' +
        pathState.getEndNodeState().getNode().getName(),
    );

    const process = new PathStateProcess();
    process.setPathState(pathState);
    process.setDirection(direction);
    this.getRealTimeProcess(bizinst).getFlowProcess().getPathStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  arriveStepState(bizinst, stepState) {
    console.log(
      '到达步骤：' +
        stepState.getActionNodeState().getNode().getName() +
        '下步骤' +
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
    console.log(
      '处理步骤：' +
        stepState.getActionNodeState().getNode().getName() +
        '下步骤' +
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
    console.log('实例终止');
    const process = new ActionNodeStateProcess();
    process.setNodeState(stepState.getActionNodeState());
    process.setStepState(stepState);
    process.setActionNodeStateProcessHandleWay(EActionNodeStateProcessHandleWay.Stop);
    this.getRealTimeProcess(bizinst).getFlowProcess().getActionNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  startChildBizinst(bizinst, compositeNodeState) {
    console.log('开始子实例：' + compositeNodeState.getNode().getName());
    const process = new CompositeNodeStateProcess();
    process.setNodeState(compositeNodeState);
    process.setChildBizinst(compositeNodeState.getBizinst());
    process.setCompositeNodeStateProcessHandleWay(ECompositeNodeStateProcessHandleWay.startChildBizinst);
    this.getRealTimeProcess(bizinst).getFlowProcess().getCompositeNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  openChildBizinst(bizinst, compositeNodeState) {
    console.log('打开子实例：' + compositeNodeState.getNode().getName());
    const process = new CompositeNodeStateProcess();
    process.setNodeState(compositeNodeState);
    process.setChildBizinst(compositeNodeState.getBizinst());
    process.setCompositeNodeStateProcessHandleWay(ECompositeNodeStateProcessHandleWay.openChildBizinst);
    this.getRealTimeProcess(bizinst).getFlowProcess().getCompositeNodeStateProcesses().push(process);
    this.bizinstTreeBox.saveState(bizinst, process);
  }

  noticeParentBizinst(parentBizinst, childBizinst, compositeNodeState, routeNoteInfo, sourceNoteInfo) {
    console.log('通知父实例');
    const process = new CompositeNodeStateProcess();
    process.setNodeState(compositeNodeState);
    process.setChildBizinst(compositeNodeState.getBizinst());
    process.setCompositeNodeStateProcessHandleWay(ECompositeNodeStateProcessHandleWay.noticeParentBizinst);
    process.setRouteNoteInfo(routeNoteInfo);
    process.setSourceNoteInfo(sourceNoteInfo);
    this.getRealTimeProcess(parentBizinst).getFlowProcess().getCompositeNodeStateProcesses().push(process);
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

module.exports = FlowListener;
