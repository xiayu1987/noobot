/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICompositeNode = require('../../../../../../design/model/node/interfaces/composite-node');
var IBizinst = require('../../../../interfaces/bizinst');

class ICompositeNodeStateProcess {
  setChildBizinst(childBizinst) {}
  getChildBizinst() {}
  setCompositeNodeStateProcessHandleWay(compositeNodeStateProcessHandleWay) {}
  getCompositeNodeStateProcessHandleWay() {}
  setRouteNoteInfo(routeNoteInfo) {}
  getRouteNoteInfo() {}
  setSourceNoteInfo(sourceNoteInfo) {}
  getSourceNoteInfo() {}
}

module.exports = ICompositeNodeStateProcess;
