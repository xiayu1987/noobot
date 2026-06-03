/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ICanPersistence = require('../../../../../../interfaces/can-persistence');

class IFlowProcess {
  setDiscoverModelStateProcesses(discoverModelStateProcesses) {}
  getDiscoverModelStateProcesses() {}
  setActionNodeStateProcesses(actionNodeStateProcess) {}
  getActionNodeStateProcesses() {}
  setCompositeNodeStateProcesses(compositeNodeStateProcesses) {}
  getCompositeNodeStateProcesses() {}
  setStateNodeStateProcesses(stateNodeStateProcesses) {}
  getStateNodeStateProcesses() {}
  setPathStateProcesses(pathStateProcesses) {}
  getPathStateProcesses() {}
}

module.exports = IFlowProcess;
