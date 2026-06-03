/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import CanPersistenceBase from '../../../can-persistence-base.js';
import INode from '../node/interfaces/node.js';

class Flowto extends CanPersistenceBase {
  constructor() {
    super();
    this.startNode = null;
    this.endNode = null;
    this.name = null;
    this.condition = "";
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
  setCondition(condition) {
    this.condition = condition;
  }
  getCondition() {
    return this.condition;
  }
}

export default  Flowto;
