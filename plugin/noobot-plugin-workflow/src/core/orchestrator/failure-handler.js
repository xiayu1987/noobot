/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createBotDispatchHandled } from "@noobot/agent-transport-protocol/bot-dispatch";
import { text } from "@noobot/shared/value";

const WORKFLOW_EXECUTION_FAILED = "WORKFLOW_EXECUTION_FAILED";

export function handleWorkflowFailure(error) {
  return createBotDispatchHandled({
    owner: "workflow",
    failure: {
      code: text(error?.code) || WORKFLOW_EXECUTION_FAILED,
      message: String(error?.message || error),
    },
  });
}
