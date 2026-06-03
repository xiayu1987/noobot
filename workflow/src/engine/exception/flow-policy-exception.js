/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import FlowException from './flow-exception.js';

class FlowPolicyException extends FlowException {
  constructor(msg = 'FlowPolicyException') {
    super(msg);
    this.name = 'FlowPolicyException';
  }
}

export default  FlowPolicyException;
