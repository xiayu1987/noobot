/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICompositeNode = require('../../../../../design/model/node/interfaces/composite-node');
var IBizinst = require('../../../interfaces/bizinst');
var NodeStateProcessBase = require('./node-state-process-base');

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

module.exports = CompositeNodeStateProcess;
