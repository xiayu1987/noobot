/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import FlowException from './flow-exception.js';

class CantFlowException extends FlowException {
  constructor(msg = 'CantFlowException') {
    super(msg);
    this.name = 'CantFlowException';
  }
}

export default  CantFlowException;
