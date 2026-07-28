/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { selectExecution, selectExecutionChildren, sessionRuntimeId } from "../runtime/run-state-machine/turnRuntimeRegistry.js";

const text = (value) => String(value || "").trim();

export function createChatExecutionSelectors({ turnRuntimeRegistry, sessions, selectSubSessionMessages }) {
function selectExecutionSession(executionId = "") {
  const execution = selectExecution(turnRuntimeRegistry.value, executionId);
  if (!execution) return null;
  const sessionId = text(execution.sessionId);
  if (!sessionId) return null;
  const mainSession = sessions.value.find((item = {}) => sessionRuntimeId(item) === sessionId);
  return mainSession || selectSubSessionMessages(sessionId);
}

function selectExecutionDescendants(executionId = "") {
  const rootId = text(executionId);
  if (!rootId || !selectExecution(turnRuntimeRegistry.value, rootId)) return [];
  const descendants = [];
  const visited = new Set([rootId]);
  const queue = [...selectExecutionChildren(turnRuntimeRegistry.value, rootId)];
  while (queue.length) {
    const child = queue.shift();
    const childId = text(child?.executionId);
    if (!childId || visited.has(childId)) continue;
    visited.add(childId);
    descendants.push(child);
    queue.push(...selectExecutionChildren(turnRuntimeRegistry.value, childId));
  }
  return descendants;
}

function selectExecutionDetail(executionId = "") {
  const execution = selectExecution(turnRuntimeRegistry.value, executionId);
  if (!execution) return null;
  const session = selectExecutionSession(execution.executionId);
  return {
    execution,
    session,
    messages: Array.isArray(session?.messages) ? session.messages : [],
    children: selectExecutionChildren(turnRuntimeRegistry.value, execution.executionId),
    descendants: selectExecutionDescendants(execution.executionId),
  };
}

  return { selectExecutionSession, selectExecutionDescendants, selectExecutionDetail };
}
