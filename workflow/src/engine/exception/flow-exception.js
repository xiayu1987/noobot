/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class FlowException extends Error {
  constructor(msg = 'FlowException') {
    super(msg);
    this.name = 'FlowException';
  }
}

module.exports = FlowException;
