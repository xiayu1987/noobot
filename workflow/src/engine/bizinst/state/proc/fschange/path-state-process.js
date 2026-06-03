/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../../../can-persistence-base');
var IPathState = require('../../modelstate/interfaces/path-state');

class PathStateProcess extends CanPersistenceBase {
  constructor() {
    super();
    this.pathState = null;
    this.direction = null;
  }
  setPathState(pathState) {
    this.pathState = pathState;
  }
  getPathState() {
    return this.pathState;
  }
  setDirection(direction) {
    this.direction = direction;
  }
  getDirection() {
    return this.direction;
  }
}

module.exports = PathStateProcess;
