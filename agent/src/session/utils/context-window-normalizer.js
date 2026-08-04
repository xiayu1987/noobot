/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import {
  resolveModelFinalMessages,
  resolveModelHistoryMessages,
  resolveModelIncrementalMessages,
  resolveModelSystemMessages,
} from "@noobot/context-protocol/window-reducer";
import { filterForModelContext } from "../../context/session/message-context-policy.js";
import { AGENT_MODEL_CONTEXT_POLICY_OPTIONS } from "../../context/session/message-context-policy.js";

export const MAIN_MODEL_HISTORY_ROUND_LIMIT =
  TURN_THRESHOLDS.session.mainModelHistoryRoundLimit;

export function resolveMainModelSystemMessages({ sourceMessages = [] } = {}) {
  return resolveModelSystemMessages({
    sourceMessages,
    policyOptions: AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
  });
}

export function resolveMainModelHistoryMessages({
  sourceMessages = [],
  historyLimit = MAIN_MODEL_HISTORY_ROUND_LIMIT,
} = {}) {
  return resolveModelHistoryMessages({ sourceMessages, historyLimit });
}

export function resolveMainModelIncrementalMessages({ sourceMessages = [] } = {}) {
  return resolveModelIncrementalMessages({
    sourceMessages,
    policyOptions: AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
  });
}

export function resolveMainModelConversationMessages({
  historyMessages = [],
  incrementalMessages = [],
} = {}) {
  return [
    ...resolveMainModelHistoryMessages({ sourceMessages: historyMessages }),
    ...resolveMainModelIncrementalMessages({ sourceMessages: incrementalMessages }),
  ];
}

export function resolveMainModelFinalMessages({
  systemMessages = [],
  historyMessages = [],
  incrementalMessages = [],
  historyLimit = MAIN_MODEL_HISTORY_ROUND_LIMIT,
} = {}) {
  return resolveModelFinalMessages({
    systemMessages,
    historyMessages,
    incrementalMessages,
    historyLimit,
    policyOptions: AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
  });
}

export function filterSummarizedMessages(messages = []) {
  return filterForModelContext(messages);
}
