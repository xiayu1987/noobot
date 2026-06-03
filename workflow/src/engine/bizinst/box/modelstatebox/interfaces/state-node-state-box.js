/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IStateNode = require('../../../../../design/model/node/interfaces/state-node');
var IBizinst = require('../../../interfaces/bizinst');
var INodeState = require('../../../state/modelstate/interfaces/node-state');

class IStateNodeStateBox {
  canForwardChange(bizinst) {}
  canBackwardChange(bizinst) {}
}

module.exports = IStateNodeStateBox;
