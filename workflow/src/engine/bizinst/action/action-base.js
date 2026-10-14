/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class ActionBase {
  constructor(actionKind = "") {
    this.name = null;
    this.actionKind = actionKind;
  }
  setName(name) {
    this.name = name;
  }
  getName() {
    return this.name;
  }
  isStartAction() {
    return false;
  }
  getActionKind() {
    return this.actionKind;
  }
}

export default ActionBase;
