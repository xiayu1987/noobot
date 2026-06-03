/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class WorkFlowContext {
  static MODELBOXFACTORYNAME = 'ModelBoxFactory';
  static MODELSTATEBOXFACTORYNAME = 'ModelStateBoxFactory';
  static instance = new WorkFlowContext();
  static map = new Map();

  static getInstance() {
    return WorkFlowContext.instance;
  }

  addContextBean(id, contextBean) {
    WorkFlowContext.map.set(id, contextBean);
  }

  getContextBean(id, type) {
    const result = WorkFlowContext.map.get(id);
    if (!type) return result ?? null;
    return result instanceof type ? result : null;
  }
}

module.exports = WorkFlowContext;
