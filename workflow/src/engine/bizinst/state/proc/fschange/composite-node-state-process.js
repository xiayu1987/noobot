/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import ICompositeNode from '../../../../../design/model/node/interfaces/composite-node.js';
import IBizinst from '../../../interfaces/bizinst.js';
import NodeStateProcessBase from './node-state-process-base.js';

class CompositeNodeStateProcess extends NodeStateProcessBase {
  constructor() {
    super();
    this.childBizinst = null;
    this.compositeNodeStateProcessHandleWay = null;
    this.routeNoteInfo = null;
    this.sourceNoteInfo = null;
  }
  setChildBizinst(childBizinst) {
    this.childBizinst = childBizinst;
  }
  getChildBizinst() {
    return this.childBizinst;
  }
  setCompositeNodeStateProcessHandleWay(compositeNodeStateProcessHandleWay) {
    this.compositeNodeStateProcessHandleWay = compositeNodeStateProcessHandleWay;
  }
  getCompositeNodeStateProcessHandleWay() {
    return this.compositeNodeStateProcessHandleWay;
  }
  setRouteNoteInfo(routeNoteInfo) {
    this.routeNoteInfo = routeNoteInfo;
  }
  getRouteNoteInfo() {
    return this.routeNoteInfo;
  }
  setSourceNoteInfo(sourceNoteInfo) {
    this.sourceNoteInfo = sourceNoteInfo;
  }
  getSourceNoteInfo() {
    return this.sourceNoteInfo;
  }
}

export default  CompositeNodeStateProcess;
