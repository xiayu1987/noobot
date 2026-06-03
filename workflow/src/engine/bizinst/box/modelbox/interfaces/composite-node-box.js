/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICompositeNode = require('../../../../../design/model/node/interfaces/composite-node');
var ICompositeNodeState = require('../../../state/modelstate/interfaces/composite-node-state');
var IBizinstModel = require('../../../state/modelstate/interfaces/bizinst-model');

class ICompositeNodeBox {
  createNodeState(bizinstModel) {}
}

module.exports = ICompositeNodeBox;
