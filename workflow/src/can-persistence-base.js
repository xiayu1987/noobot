/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class CanPersistenceBase {
  constructor() {
    this.dataContext = null;
  }
  getDataContext() {
    return this.dataContext;
  }
  setDataContext(dataContext) {
    this.dataContext = dataContext;
  }
}

export default  CanPersistenceBase;
