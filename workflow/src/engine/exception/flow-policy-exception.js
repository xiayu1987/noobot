/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var FlowException = require('./flow-exception');

class FlowPolicyException extends FlowException {
  constructor(msg = 'FlowPolicyException') {
    super(msg);
    this.name = 'FlowPolicyException';
  }
}

module.exports = FlowPolicyException;
