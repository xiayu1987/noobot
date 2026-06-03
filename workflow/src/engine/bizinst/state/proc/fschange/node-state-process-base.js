/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../../../can-persistence-base.js';

class NodeStateProcessBase extends CanPersistenceBase {
  constructor() {
    super();
    this.nodeState = null;
    this.handleWay = 0;
  }

  setNodeState(nodeState) {
    this.nodeState = nodeState;
  }

  getNodeState() {
    return this.nodeState;
  }

  setHandleWay(handleWay) {
    this.handleWay = handleWay;
  }

  getHandleWay() {
    return this.handleWay;
  }
}

export default  NodeStateProcessBase;
