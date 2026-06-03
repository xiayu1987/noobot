/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../../can-persistence-base.js';

class StepState extends CanPersistenceBase {
  constructor() {
    super();
    this.actionNodeState = null;
    this.index = null;
  }
  setActionNodeState(actionNodeState) {
    this.actionNodeState = actionNodeState;
  }
  getActionNodeState() {
    return this.actionNodeState;
  }
  setIndex(index) {
    this.index = index;
  }
  getIndex() {
    return this.index;
  }
}

export default  StepState;
