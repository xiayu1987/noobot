/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../../../can-persistence-base.js';

class FlowProcess extends CanPersistenceBase {
  constructor() {
    super();
    this.actionNodeStateProcess = null;
    this.compositeNodeStateProcesses = null;
    this.stateNodeStateProcesses = null;
    this.discoverModelStateProcesses = null;
    this.pathStateProcesses = null;
    this.actionNodeStateProcess = [];
    this.compositeNodeStateProcesses = [];
    this.stateNodeStateProcesses = [];
    this.pathStateProcesses = [];
    this.discoverModelStateProcesses = [];
  }
  setActionNodeStateProcesses(actionNodeStateProcess) {
    this.actionNodeStateProcess = actionNodeStateProcess;
  }
  getActionNodeStateProcesses() {
    return this.actionNodeStateProcess;
  }
  setCompositeNodeStateProcesses(compositeNodeStateProcesses) {
    this.compositeNodeStateProcesses = compositeNodeStateProcesses;
  }
  getCompositeNodeStateProcesses() {
    return this.compositeNodeStateProcesses;
  }
  setStateNodeStateProcesses(stateNodeStateProcesses) {
    this.stateNodeStateProcesses = stateNodeStateProcesses;
  }
  getStateNodeStateProcesses() {
    return this.stateNodeStateProcesses;
  }
  setPathStateProcesses(pathStateProcesses) {
    this.pathStateProcesses = pathStateProcesses;
  }
  getPathStateProcesses() {
    return this.pathStateProcesses;
  }
  setDiscoverModelStateProcesses(discoverModelStateProcesses) {
    this.discoverModelStateProcesses = discoverModelStateProcesses;
  }
  getDiscoverModelStateProcesses() {
    return this.discoverModelStateProcesses;
  }
}

export default  FlowProcess;
