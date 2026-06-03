/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var Bizinst = require('../../bizinst');
var Process = require('../../state/process');
var ProcessChain = require('../../state/process-chain');
var State = require('../../state/state');
var SourceInfo = require('../../state/currentstate/source-info');
var ECurrentStateSourceType = require('../../state/currentstate/enums/current-state-source-type');
var EModelStateType = require('../../state/modelstate/enums/model-state-type');
var EActionNodeStateProcessHandleWay = require('../../state/proc/fschange/enums/action-node-state-process-handle-way');
var ECompositeNodeStateProcessHandleWay = require('../../state/proc/fschange/enums/composite-node-state-process-handle-way');
var EStateNodeStateProcessHandleWay = require('../../state/proc/fschange/enums/state-node-state-process-handle-way');

class BizinstBox {
  constructor() {
    this.bizinst = null;
    this.realTimeProcess = null;
    this.resetRealTimeProcess();
  }

  setBizinst(bizinst) {
    this.bizinst = bizinst;
  }

  getBizinst() {
    return this.bizinst;
  }

  getRealTimeProcess() {
    return this.realTimeProcess;
  }

  resetRealTimeProcess() {
    this.realTimeProcess = new Process();
  }

  static createBizinst(business, model) {
    const bizinst = new Bizinst();

    business.setBizinst(bizinst);
    bizinst.setModel(model);
    bizinst.setBusiness(business);

    const processChain = new ProcessChain();
    processChain.setBizinst(bizinst);
    bizinst.setProcessChain(processChain);

    const state = new State();
    state.setBizinst(bizinst);
    bizinst.setState(state);

    return bizinst;
  }

  saveState(stateProcess) {
    if (!stateProcess) return;

    if (typeof stateProcess.getStepState === 'function' && typeof stateProcess.getActionNodeStateProcessHandleWay === 'function') {
      this._saveActionNodeState(stateProcess);
      return;
    }
    if (typeof stateProcess.getCompositeNodeStateProcessHandleWay === 'function') {
      this._saveCompositeNodeState(stateProcess);
      return;
    }
    if (typeof stateProcess.getStateNodeStateProcessHandleWay === 'function') {
      this._saveStateNodeState(stateProcess);
      return;
    }
    if (typeof stateProcess.getModelStateType === 'function' && typeof stateProcess.getModelState === 'function') {
      this._saveDiscoverModelState(stateProcess);
      return;
    }
    if (typeof stateProcess.getPathState === 'function') {
      this.bizinst.getState().getBizinstModel().getPathStates().push(stateProcess.getPathState());
      return;
    }
    if (typeof stateProcess.getActionNodeState === 'function' && typeof stateProcess.getHandleStepState === 'function') {
      this._saveAddStepState(stateProcess);
    }
  }

  _saveActionNodeState(process) {
    const stepState = process.getStepState();
    const handleWay = process.getActionNodeStateProcessHandleWay();

    if (handleWay === EActionNodeStateProcessHandleWay.Arrive) {
      this.bizinst.getState().getCurrentState().getCurrentStepStates().push(stepState);
    }
    if (handleWay === EActionNodeStateProcessHandleWay.Handle) {
      const arr = this.bizinst.getState().getCurrentState().getCurrentStepStates();
      const idx = arr.indexOf(stepState);
      if (idx >= 0) arr.splice(idx, 1);
    }
    if (handleWay === EActionNodeStateProcessHandleWay.Stop) {
      this.bizinst.getState().getCurrentState().setCurrentStateSourceType(ECurrentStateSourceType.currentBizinst);

      const sourceInfo = new SourceInfo();
      sourceInfo.setModelState(stepState);
      sourceInfo.setSourceHandleWay(handleWay);
      sourceInfo.setModelStateType(EModelStateType.ActionNodeState);
      this.bizinst.getState().getCurrentState().setSourceInfo(sourceInfo);
    }
  }

  _saveCompositeNodeState(process) {
    const handleWay = process.getCompositeNodeStateProcessHandleWay();
    if (handleWay === ECompositeNodeStateProcessHandleWay.startChildBizinst) {
      const childBizinst = process.getChildBizinst();
      this.bizinst.getChildBizinsts().push(childBizinst);
      childBizinst.setParentBizinst(this.bizinst);
    }
  }

  _saveStateNodeState(process) {
    const handleWay = process.getStateNodeStateProcessHandleWay();
    const stateNodeState = process.getNodeState();

    if (handleWay === EStateNodeStateProcessHandleWay.takePartIn) {
      this.bizinst.getState().getCurrentState().getStateNodeStates().push(stateNodeState);
    }

    if ([EStateNodeStateProcessHandleWay.start, EStateNodeStateProcessHandleWay.end, EStateNodeStateProcessHandleWay.forwardStateChange].includes(handleWay)) {
      this.bizinst.getState().getCurrentState().setCurrentStateSourceType(ECurrentStateSourceType.currentBizinst);
      const sourceInfo = new SourceInfo();
      sourceInfo.setModelState(stateNodeState);
      sourceInfo.setSourceHandleWay(handleWay);
      sourceInfo.setModelStateType(EModelStateType.StateNodeState);
      this.bizinst.getState().getCurrentState().setSourceInfo(sourceInfo);
    }

    if ([EStateNodeStateProcessHandleWay.open, EStateNodeStateProcessHandleWay.close, EStateNodeStateProcessHandleWay.backwardStateChange].includes(handleWay)) {
      this.bizinst.getState().getCurrentState().setCurrentStateSourceType(ECurrentStateSourceType.currentBizinst);
      const sourceInfo = new SourceInfo();
      sourceInfo.setModelState(stateNodeState);
      sourceInfo.setSourceHandleWay(handleWay);
      sourceInfo.setModelStateType(EModelStateType.StateNodeState);
      this.bizinst.getState().getCurrentState().setSourceInfo(sourceInfo);
      this.bizinst.getState().getCurrentState().setStateNodeStates([]);
    }
  }

  _saveDiscoverModelState(process) {
    const modelStateType = process.getModelStateType();
    const modelState = process.getModelState();
    const bizinstModel = this.bizinst.getState().getBizinstModel();

    if (modelStateType === EModelStateType.ActionNodeState) bizinstModel.getActionNodeStates().push(modelState);
    if (modelStateType === EModelStateType.CompositeNodeState) bizinstModel.getCompositeNodeStates().push(modelState);
    if (modelStateType === EModelStateType.StateNodeState) bizinstModel.getStateNodeStates().push(modelState);
    if (modelStateType === EModelStateType.FlowtoState) bizinstModel.getFlowtoStates().push(modelState);
  }

  _saveAddStepState(process) {
    const actionNodeState = process.getActionNodeState();
    const stepState = process.getStepState();
    const handleStepState = process.getHandleStepState();

    const actionNodeStates = this.bizinst.getState().getBizinstModel().getActionNodeStates() || [];
    for (const item of actionNodeStates) {
      if (item === actionNodeState) {
        item.getStepStates().push(stepState);
        item.setStepStates(item.getStepStates().sort((a, b) => a.getIndex() - b.getIndex()));

        const currentSteps = this.bizinst.getState().getCurrentState().getCurrentStepStates();
        currentSteps.push(stepState);
        const idx = currentSteps.indexOf(handleStepState);
        if (idx >= 0) currentSteps.splice(idx, 1);
        break;
      }
    }
  }

  saveProcess() {
    this.realTimeProcess.setProcessChain(this.bizinst.getProcessChain());
    this.bizinst.getProcessChain().getProcesses().push(this.realTimeProcess);
    this.resetRealTimeProcess();
  }
}

module.exports = BizinstBox;
