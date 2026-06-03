/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IActor = require('./actor/interfaces/actor');
var IContent = require('./content/interfaces/content');
var NodeBase = require('./node-base');

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

module.exports = ActionNode;
