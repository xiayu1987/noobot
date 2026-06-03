/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../../../can-persistence-base');

class BizinstModelChangeProcess extends CanPersistenceBase {
  constructor() {
    super();
    this.addStepStateProcesses = null;
    this.addStepStateProcesses = [];
  }
  setAddStepStateProcesses(addStepStateProcesses) {
    this.addStepStateProcesses = addStepStateProcesses;
  }
  getAddStepStateProcesses() {
    return this.addStepStateProcesses;
  }
}

module.exports = BizinstModelChangeProcess;
