/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class ActionBase {
  constructor() {
    this.name = null;
  }
  setName(name) {
    this.name = name;
  }
  getName() {
    return this.name;
  }
}

export default  ActionBase;
