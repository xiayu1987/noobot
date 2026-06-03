/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICompositeNode = require('../../../../design/model/node/interfaces/composite-node');
var IBizinst = require('../../interfaces/bizinst');
var BizinstBox = require('../bizinstbox/bizinst-box');
var CompositeNodeState = require('../../state/modelstate/composite-node-state');
var ICompositeNodeState = require('../../state/modelstate/interfaces/composite-node-state');
var IBizinstModel = require('../../state/modelstate/interfaces/bizinst-model');
var NodeBoxBase = require('./node-box-base');

class CompositeNodeBox extends NodeBoxBase {
  constructor() {
    super();
  }
  createNodeState(bizinstModel) {
    const result = new CompositeNodeState();
    result.setNode(this.getNode());
    result.setBizinstModel(bizinstModel);
    const childBizinst = BizinstBox.createBizinst(result, this.getNode());
    childBizinst.setParentBizinst(bizinstModel.getState().getBizinst());
    result.setBizinst(childBizinst);
    return result;
  }
}

module.exports = CompositeNodeBox;
