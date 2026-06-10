/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PHASE_STATUS, WORKFLOW_RETRY } from "../constants.js";

export function createWorkflowRetryMeta() {
  return {
    maxAttempts: WORKFLOW_RETRY.MAX_ATTEMPTS,
    attempts: WORKFLOW_RETRY.MAX_ATTEMPTS,
    history: [],
  };
}

export function markWorkflowRetrySucceeded(retryMeta = {}) {
  const history = Array.isArray(retryMeta?.history) ? retryMeta.history : [];
  if (!Array.isArray(retryMeta?.history)) {
    retryMeta.history = history;
  }
  history.push({
    attempt: 1,
    status: WORKFLOW_PHASE_STATUS.SUCCEEDED,
    timestamp: new Date().toISOString(),
  });
  return retryMeta;
}
