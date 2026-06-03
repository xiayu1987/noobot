/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../../can-persistence-base');
var IState = require('../interfaces/state');

class BizinstModel extends CanPersistenceBase {
  constructor() {
    super();
    this.actionNodeStates = null;
    this.compositeNodeStates = null;
    this.stateNodeStates = null;
    this.flowtoStates = null;
    this.pathStates = null;
    this.state = null;
    this.actionNodeStates = [];
    this.compositeNodeStates = [];
    this.stateNodeStates = [];
    this.flowtoStates = [];
    this.pathStates = [];
  }
  setState(state) {
    this.state = state;
  }
  getState() {
    return this.state;
  }
  setActionNodeStates(actionNodeStates) {
    this.actionNodeStates = actionNodeStates;
  }
  getActionNodeStates() {
    return this.actionNodeStates;
  }
  setCompositeNodeStates(compositeNodeStates) {
    this.compositeNodeStates = compositeNodeStates;
  }
  getCompositeNodeStates() {
    return this.compositeNodeStates;
  }
  setStateNodeStates(stateNodeStates) {
    this.stateNodeStates = stateNodeStates;
  }
  getStateNodeStates() {
    return this.stateNodeStates;
  }
  setFlowtoStates(flowtoStates) {
    this.flowtoStates = flowtoStates;
  }
  getFlowtoStates() {
    return this.flowtoStates;
  }
  setPathStates(pathStates) {
    this.pathStates = pathStates;
  }
  getPathStates() {
    return this.pathStates;
  }
}

module.exports = BizinstModel;
