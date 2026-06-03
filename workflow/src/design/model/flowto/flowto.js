/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var CanPersistenceBase = require('../../../can-persistence-base');
var INode = require('../node/interfaces/node');

class Flowto extends CanPersistenceBase {
  constructor() {
    super();
    this.startNode = null;
    this.endNode = null;
    this.name = null;
  }
  getStartNode() {
    return this.startNode;
  }
  setStartNode(startNode) {
    this.startNode = startNode;
  }
  getEndNode() {
    return this.endNode;
  }
  setEndNode(endNode) {
    this.endNode = endNode;
  }
  setName(name) {
    this.name = name;
  }
  getName() {
    return this.name;
  }
}

module.exports = Flowto;
