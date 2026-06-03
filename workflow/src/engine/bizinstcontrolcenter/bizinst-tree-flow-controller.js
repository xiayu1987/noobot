/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IStartAction = require('../bizinst/action/interfaces/start-action');
var IBizinstTreeBox = require('../bizinst/box/bizinstbox/interfaces/bizinst-tree-box');
var IStepState = require('../bizinst/state/modelstate/interfaces/step-state');
var FlowException = require('../exception/flow-exception');

class BizinstTreeFlowControler {
  constructor() {}

  execAction(flowAction, bizinstTreeBox, stepState) {
    let FlowListener;
    try {
      FlowListener = require('./flow-listener');
    } catch (e) {
      FlowListener = class {
        setBizinstTreeBox() {}
      };
    }
    const flowListener = new FlowListener();
    flowListener.setBizinstTreeBox(bizinstTreeBox);

    const isStartAction =
      flowAction instanceof IStartAction ||
      flowAction?.getName?.() === '开始' ||
      (flowAction && flowAction.constructor && flowAction.constructor.name === 'StartAction');

    if (isStartAction) {
      flowAction.exec(bizinstTreeBox.getRootBizinst(), null, flowListener);
    } else {
      flowAction.exec(bizinstTreeBox.getCurrentBizinst(stepState), stepState, flowListener);
    }
  }
}

module.exports = BizinstTreeFlowControler;
