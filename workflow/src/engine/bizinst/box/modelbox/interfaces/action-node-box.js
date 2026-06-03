/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IActionNode = require('../../../../../design/model/node/interfaces/action-node');
var IActionNodeState = require('../../../state/modelstate/interfaces/action-node-state');
var IBizinstModel = require('../../../state/modelstate/interfaces/bizinst-model');

class IActionNodeBox {
  createNodeState(bizinstModel) {}
}

module.exports = IActionNodeBox;
