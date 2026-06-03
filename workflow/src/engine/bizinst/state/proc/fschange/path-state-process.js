/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../../../can-persistence-base.js';
import IPathState from '../../modelstate/interfaces/path-state.js';

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

export default  PathStateProcess;
