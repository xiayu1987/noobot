/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  selectExecution,
  selectExecutionChildren,
  sessionRuntimeId,
} from "../runtime/run-state-machine/turnRuntimeRegistry.js";
import { text } from "@noobot/shared/value";
import { requireSelectedExecutionDetail } from "@noobot/plugin-protocol/frontend";
import { selectExecutionRelations } from "@noobot/session-protocol/execution-lifecycle";

export function createChatExecutionSelectors({
  turnRuntimeRegistry,
  sessions,
  selectSubSessionMessages,
}) {
  function selectExecutionSession(executionId = "") {
    const execution = selectExecution(turnRuntimeRegistry.value, executionId);
    if (!execution) return null;
    const sessionId = text(execution.sessionId);
    if (!sessionId) return null;
    const mainSession = sessions.value.find((item = {}) => sessionRuntimeId(item) === sessionId);
    return mainSession || selectSubSessionMessages(sessionId);
  }

  function selectExecutionDescendants(executionId) {
    return selectExecutionRelations(turnRuntimeRegistry.value.executions, executionId, {
      descendants: true,
    });
  }

  function selectExecutionDetail(executionId = "") {
    const execution = selectExecution(turnRuntimeRegistry.value, executionId);
    if (!execution) return null;
    const session = selectExecutionSession(execution.executionId);
    if (!session) return null;
    return requireSelectedExecutionDetail(
      {
        execution,
        session,
        children: selectExecutionChildren(turnRuntimeRegistry.value, execution.executionId),
        descendants: selectExecutionDescendants(execution.executionId),
      },
      { executionId: execution.executionId },
    );
  }

  return { selectExecutionSession, selectExecutionDescendants, selectExecutionDetail };
}
