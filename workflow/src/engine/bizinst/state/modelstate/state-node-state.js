/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IStateNode = require('../../../../design/model/node/interfaces/state-node');
var NodeStateBase = require('./node-state-base');

class StateNodeState extends NodeStateBase {
  constructor() {
    super();
  }
}

module.exports = StateNodeState;
