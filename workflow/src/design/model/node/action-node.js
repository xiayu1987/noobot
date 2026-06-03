/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IActor from './actor/interfaces/actor.js';
import IContent from './content/interfaces/content.js';
import NodeBase from './node-base.js';

class ActionNode extends NodeBase {
  constructor() {
    super();
    this.nodeContent = null;
    this.nodeActor = null;
  }
  setNodeContent(nodeContent) {
    this.nodeContent = nodeContent;
  }
  getNodeContent() {
    return this.nodeContent;
  }
  setNodeActor(nodeActor) {
    this.nodeActor = nodeActor;
  }
  getNodeActor() {
    return this.nodeActor;
  }
}

export default  ActionNode;
