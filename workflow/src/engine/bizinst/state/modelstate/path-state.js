/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../../can-persistence-base');
var IFlowtoState = require('./interfaces/flowto-state');
var INodeState = require('./interfaces/node-state');

class PathState extends CanPersistenceBase {
  constructor() {
    super();
    this.bizinstModel = null;
    this.startNodeState = null;
    this.endNodeState = null;
    this.flowtoState = null;
  }
  setStartNodeState(startNodeState) {
    this.startNodeState = startNodeState;
  }
  getStartNodeState() {
    return this.startNodeState;
  }
  setEndNodeState(endNodeState) {
    this.endNodeState = endNodeState;
  }
  getEndNodeState() {
    return this.endNodeState;
  }
  setFlowtoState(flowtoState) {
    this.flowtoState = flowtoState;
  }
  getFlowtoState() {
    return this.flowtoState;
  }
  setBizinstModel(bizinstModel) {
    this.bizinstModel = bizinstModel;
  }
  getBizinstModel() {
    return this.bizinstModel;
  }
}

module.exports = PathState;
