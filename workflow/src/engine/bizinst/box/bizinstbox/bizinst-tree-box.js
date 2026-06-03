/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ActionRecord from '../../action-record.js';
import ProcessRecord from '../../process-record.js';
import BizinstBox from './bizinst-box.js';
import ECompositeNodeStateProcessHandleWay from '../../state/proc/fschange/enums/composite-node-state-process-handle-way.js';

class BizinstTreeBox {
  constructor() {
    this.bizinstTreeRecord = null;
    this.rootBizinst = null;
    this.bizinstAndBizinstBoxMap = new Map();
    this.bizinstAndIsHasProcess = new Map();
  }

  setBizinstTreeRecord(bizinstTreeRecord) {
    this.bizinstTreeRecord = bizinstTreeRecord;
  }

  getBizinstTreeRecord() {
    return this.bizinstTreeRecord;
  }

  setBizinst(bizinst) {
    this.rootBizinst = this.findRootBizinst(bizinst);
    this.bizinstAndBizinstBoxMap = new Map();

    this.loopBizinst(this.rootBizinst, (currentBizinst) => {
      this.bizinstAndBizinstBoxMap.set(currentBizinst, this._createBizinstBox(currentBizinst));
    });
  }

  getRootBizinst() {
    return this.rootBizinst;
  }

  getCurrentBizinst(stepState) {
    if (!stepState) return null;
    let currentBizinst = null;

    this.loopBizinst(this.rootBizinst, (bizinst) => {
      const actionNodeStates = bizinst?.getState?.()?.getBizinstModel?.()?.getActionNodeStates?.() || [];
      for (const actionNodeState of actionNodeStates) {
        if (actionNodeState === stepState.getActionNodeState()) {
          currentBizinst = bizinst;
          break;
        }
      }
    });

    return currentBizinst;
  }

  getRealTimeProcess(bizinst) {
    const box = this.getBizinstBox(bizinst);
    return box ? box.getRealTimeProcess() : null;
  }

  saveState(bizinst, stateProcess) {
    const box = this.getBizinstBox(bizinst);
    if (!box || !stateProcess) return;

    box.saveState(stateProcess);
    this.bizinstAndIsHasProcess.set(bizinst, true);

    if (typeof stateProcess.getChildBizinst === 'function' && typeof stateProcess.getCompositeNodeStateProcessHandleWay === 'function') {
      const childBizinst = stateProcess.getChildBizinst();
      if (childBizinst && stateProcess.getCompositeNodeStateProcessHandleWay() === ECompositeNodeStateProcessHandleWay.startChildBizinst) {
        this.bizinstAndBizinstBoxMap.set(childBizinst, this._createBizinstBox(childBizinst));
      }
    }
  }

  saveProcess(action) {
    const actionRecord = new ActionRecord();
    actionRecord.setAction(action);
    actionRecord.setSort((this.bizinstTreeRecord.getActionRecords() || []).length);

    const processRecords = [];
    actionRecord.setProcessRecords(processRecords);
    this.bizinstTreeRecord.getActionRecords().push(actionRecord);

    this.loopBizinst(this.rootBizinst, (bizinst) => {
      if (!this.bizinstAndIsHasProcess.has(bizinst)) return;

      const process = this.getBizinstBox(bizinst).getRealTimeProcess();
      const processRecord = new ProcessRecord();
      processRecord.setBizinst(bizinst);
      processRecord.setProcess(process);
      processRecords.push(processRecord);

      this.getBizinstBox(bizinst).saveProcess();
    });
  }

  loopBizinst(bizinst, loopCallBack) {
    if (!bizinst) return;
    if (loopCallBack) loopCallBack(bizinst);

    const children = bizinst.getChildBizinsts ? bizinst.getChildBizinsts() : [];
    for (const childBizinst of children || []) {
      this.loopBizinst(childBizinst, loopCallBack);
    }
  }

  findRootBizinst(bizinst) {
    if (!bizinst) return null;
    if (!bizinst.getParentBizinst || bizinst.getParentBizinst() == null) return bizinst;
    return this.findRootBizinst(bizinst.getParentBizinst());
  }

  getBizinstBox(bizinst) {
    return this.bizinstAndBizinstBoxMap.get(bizinst);
  }

  _createBizinstBox(bizinst) {
    const box = new BizinstBox();
    box.setBizinst(bizinst);
    return box;
  }
}

export default  BizinstTreeBox;
