/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

// E2E waits are protocol budgets, not provider retry budgets. Keep the
// budgets here so lifecycle, persistence, and model-observation assertions
// converge on the same authoritative limits.
export const PROTOCOL_TIMEOUTS = Object.freeze({
  model: 420000,
  toolChain: 900000,
  workflow: 900000,
  harness: 1800000,
  audit: 420000,
});
