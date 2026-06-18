/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveTurnMessagesStore,
  resolveTurnTasksStore,
} from "../../../context/session/current-turn-store.js";
import { emitEvent } from "../../../event/index.js";
import { createStateCommitter } from "../execution/state-committer.js";
import { persistModelGeneratedArtifacts } from "../media/artifact-service.js";
import { resolveCurrentModelInfo } from "../model/model-manager.js";

export async function commitNoToolsTurnState({
  modelState,
  loopState,
  messages = [],
  traces = [],
  modelResponse = null,
  responseContentText = "",
  turn,
} = {}) {
  const {
    turnMessages,
    currentTurnMessages,
    currentTurnTasks,
    dialogProcessId,
  } = loopState;
  const { eventListener, runtime } = modelState;

  const turnMessageStore = resolveTurnMessagesStore(currentTurnMessages, turnMessages);
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  const turnTaskStore = resolveTurnTasksStore(currentTurnTasks, loopState.turnTasks || []);
  const stateCommitter = createStateCommitter({
    messages,
    traces,
    turnMessageStore,
    dialogProcessId,
    runtime,
    agentContext: modelState?.agentContext || null,
  });

  await stateCommitter.pushAssistantMessage({
    content: responseContentText,
    rawModelContent: modelResponse?.content ?? null,
    modelAdditionalKwargs: modelResponse?.additional_kwargs ?? null,
    modelResponseMetadata: modelResponse?.response_metadata ?? null,
    type: "message",
    toolCalls: [],
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
  });
  await persistModelGeneratedArtifacts({
    aiContent: modelResponse?.content,
    runtime,
    eventListener,
    dialogProcessId,
    turnMessageStore,
  });
  emitEvent(eventListener, "llm_call_end", { turn, hasToolCalls: false, mode: "no_tools" });

  return { turnMessageStore, turnTaskStore };
}
