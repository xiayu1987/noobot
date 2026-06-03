/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IStateNode = require('../../../../../design/model/node/interfaces/state-node');
var NodeStateProcessBase = require('./node-state-process-base');

class StateNodeStateProcess extends NodeStateProcessBase {
  constructor() {
    super();
    this.stateNodeStateProcessHandleWay = null;
  }
  setStateNodeStateProcessHandleWay(stateNodeStateProcessHandleWay) {
    this.stateNodeStateProcessHandleWay = stateNodeStateProcessHandleWay;
  }
  getStateNodeStateProcessHandleWay() {
    return this.stateNodeStateProcessHandleWay;
  }
}

module.exports = StateNodeStateProcess;
