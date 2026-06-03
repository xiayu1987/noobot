/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var FlowException = require('./flow-exception');

class CantFlowException extends FlowException {
  constructor(msg = 'CantFlowException') {
    super(msg);
    this.name = 'CantFlowException';
  }
}

module.exports = CantFlowException;
