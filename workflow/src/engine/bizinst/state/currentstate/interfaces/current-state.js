/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class ICurrentState {
  setCurrentStateSourceType(currentStateSourceType) {}
  getCurrentStateSourceType() {}
  setSourceInfo(sourceInfo) {}
  getSourceInfo() {}
  setSourceInfoSource(sourceInfoSource) {}
  getSourceInfoSource() {}
  setCurrentStepStates(currentStepStates) {}
  getCurrentStepStates() {}
  setStateNodeStates(stateNodeStates) {}
  getStateNodeStates() {}
}

export default ICurrentState;
