/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../../can-persistence-base.js';
import IFlowtoState from './interfaces/flowto-state.js';
import INodeState from './interfaces/node-state.js';

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

export default  PathState;
