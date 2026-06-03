/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import BizinstTreeRecord from '../bizinst/bizinst-tree-record.js';
import StartAction from '../bizinst/action/start-action.js';
import BizinstBoxFactory from '../bizinst/box/bizinstbox/bizinst-box-factory.js';
import BizinstFlowEngine from './bizinst-flow-engine.js';
import BizinstTreeFlowControler from './bizinst-tree-flow-controller.js';
import BizinstTreeModelChangeControler from './bizinst-tree-model-change-controller.js';
import StartBizinstInfo from './start-bizinst-info.js';

class BizinstTreeControlCenter {
  constructor() {
    this.bizinstTreeFlowControler = new BizinstTreeFlowControler();
    this.bizinstTreeModelChangeControler = new BizinstTreeModelChangeControler();
  }

  execAction(action, bizinst, stepState, bizinstTreeRecord) {
    if (!action || !bizinst || !stepState || !bizinstTreeRecord) return null;

    const bizinstTreeBox = BizinstBoxFactory.getInstance().getBizinstTreeBox(bizinst, bizinstTreeRecord);

    const name = action?.constructor?.name;
    const isModelStateChangeAction = ['NextAddStepAction', 'NextSignatureAction', 'PreAddStepAction', 'PreSignatureAction'].includes(name);
    const isFlowAction = ['AuditAction', 'BackAction', 'StartAction', 'StopAction', 'SubmitAction'].includes(name);

    if (isModelStateChangeAction) {
      this.bizinstTreeModelChangeControler.execAction(action, bizinstTreeBox, stepState);
    }
    if (isFlowAction) {
      this.bizinstTreeFlowControler.execAction(action, bizinstTreeBox, stepState);
    }

    bizinstTreeBox.saveProcess(action);
    return this.getActionRecord(action, bizinstTreeBox.getBizinstTreeRecord());
  }

  startBizinst(business, model) {
    if (!business || !model) return null;

    const result = new StartBizinstInfo();
    const bizinst = BizinstFlowEngine.getInstance().createBizinst(business, model);

    const bizinstTreeRecord = new BizinstTreeRecord();
    bizinstTreeRecord.setRootBizinst(bizinst);

    const bizinstTreeBox = BizinstBoxFactory.getInstance().getBizinstTreeBox(bizinst, bizinstTreeRecord);

    const startAction = new StartAction();
    this.bizinstTreeFlowControler.execAction(startAction, bizinstTreeBox, null);
    bizinstTreeBox.saveProcess(startAction);

    result.setBizinst(bizinst);
    result.setActionRecord(this.getActionRecord(startAction, bizinstTreeBox.getBizinstTreeRecord()));
    result.setBizinstTreeRecord(bizinstTreeRecord);
    return result;
  }

  getActionRecord(action, bizinstTreeRecord) {
    let result = null;
    const actionRecords = bizinstTreeRecord.getActionRecords() || [];
    for (const actionRecord of actionRecords) {
      if (action === actionRecord.getAction()) {
        result = actionRecord;
      }
    }
    return result;
  }
}

export default  BizinstTreeControlCenter;
