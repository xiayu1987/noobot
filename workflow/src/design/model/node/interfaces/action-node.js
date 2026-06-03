/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var IActor = require('../actor/interfaces/actor');
var IContent = require('../content/interfaces/content');

class IActionNode {
  setNodeContent(nodeContent) {}
  getNodeContent() {}
  setNodeActor(nodeActor) {}
  getNodeActor() {}
}

module.exports = IActionNode;
