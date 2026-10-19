/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";
import { MESSAGE_BLOCK_LANES } from "@noobot/context-protocol/agent-context/schema";
import { text } from "@noobot/shared/value";

function buildAgentContextDebugData({ context, bindings }) {
  const { identity, environment, execution, modelContext } = context;
  return {
    userId: identity.userId,
    sessionId: identity.sessionId,
    rootSessionId: identity.rootSessionId,
    parentSessionId: identity.parentSessionId,
    dialogProcessId: identity.dialogProcessId,
    turnScopeId: identity.turnScopeId,
    runId: identity.runId,
    envelope: {
      kind: context.kind,
      protocolVersion: context.protocolVersion,
      keys: Object.keys(context),
      workspace: {
        cwd: text(environment.workspace?.cwd),
        basePath: text(environment.workspace?.basePath),
      },
      caller: text(execution.caller),
      modelContextProtocolVersion: modelContext.protocolVersion,
      messageBlockCounts: Object.fromEntries(
        MESSAGE_BLOCK_LANES.map((lane) => [lane, modelContext.messageBlocks[lane].length]),
      ),
    },
    bindings: {
      keys: Object.keys(bindings),
      toolCount: bindings.tools.length,
      toolNames: bindings.tools.map((tool) => text(tool.name)).filter(Boolean),
      extensionNames: Object.keys(bindings.extensions),
    },
  };
}

export function emitAgentContextDebug(eventListener, scope) {
  return emitEvent(
    eventListener,
    "agent.context.executionScopeCreated",
    buildAgentContextDebugData(scope),
  );
}
