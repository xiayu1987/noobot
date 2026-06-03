/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IStateNode = require('../../../../../design/model/node/interfaces/state-node');
var IBizinst = require('../../../interfaces/bizinst');
var IBizinstModel = require('../../../state/modelstate/interfaces/bizinst-model');
var IStateNodeState = require('../../../state/modelstate/interfaces/state-node-state');

class IStateNodeBox {
  canForwardChange(bizinst) {}
  canBackwardChange(bizinst) {}
  getLastForwardChangeStateNodeStates(bizinst) {}
  createNodeState(bizinstModel) {}
}

module.exports = IStateNodeBox;
