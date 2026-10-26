/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  requireCurrentTurnMessagesStore,
  requireCurrentTurnTasksStore,
} from "./current-turn-ledger.js";
import { emitEvent } from "../../events/index.js";
import { createStateCommitter } from "../tool-execution/state-committer.js";
import { requireActiveModelContext } from "../active-model-context.js";
import { persistModelGeneratedArtifacts } from "../../artifacts/runtime/artifact-service.js";
import { resolveCurrentModelInfo } from "../../models/runtime/current-model-info.js";

export async function commitNoToolsTurnState({
  modelState,
  loopState,
  traces = [],
  modelResponse = null,
  responseContentText = "",
  turn,
  modelMessageId = "",
  messageUid = "",
  presentationMessageId = "",
} = {}) {
  const { currentTurnMessages, currentTurnTasks } = loopState;
  const { runtime } = modelState;
  const { dialogProcessId } = requireActiveModelContext(runtime).activeTurnIdentity;
  const { eventListener } = runtime;

  const turnMessageStore = requireCurrentTurnMessagesStore(currentTurnMessages);
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  const turnTaskStore = requireCurrentTurnTasksStore(currentTurnTasks);
  const stateCommitter = createStateCommitter({
    traces,
    turnMessageStore,
    dialogProcessId,
    runtime,
    agentContext: modelState?.agentContext || null,
  });

  await stateCommitter.pushAssistantMessage({
    content: responseContentText,
    rawModelContent: modelResponse?.content ?? null,
    modelAdditionalKwargs: modelResponse?.responseReasoning
      ? { reasoning: modelResponse.responseReasoning }
      : null,
    modelResponseMetadata: {
      ...(modelResponse?.responseOutput ? { output: modelResponse.responseOutput } : {}),
      ...(modelResponse?.finishReason ? { finishReason: modelResponse.finishReason } : {}),
      ...(modelResponse?.usage ? { usage: modelResponse.usage } : {}),
    },
    type: "message",
    toolCalls: [],
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
    modelMessageId,
    messageUid,
    presentationMessageId,
    chatPresentation: true,
    attachments: await persistModelGeneratedArtifacts({
      aiContent: modelResponse?.content,
      runtime,
      eventListener,
      dialogProcessId,
      modelMessageId,
      turnMessageStore,
    }),
  });
  emitEvent(eventListener, "llm_call_end", { turn, mode: "no_tools", toolCallCount: 0 });

  return { turnMessageStore, turnTaskStore };
}
