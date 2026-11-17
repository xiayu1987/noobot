/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { filterForModelContext } from "@noobot/context-protocol/policy/message";
import {
  capturePhaseSummarySnapshot,
  assertPhaseSummaryTargetsUnchanged,
  requirePhaseSummaryText,
  resolveSummaryScope,
} from "@noobot/context-protocol/policy/summary";
import {
  resolveContextMessageKey,
  resolveContextSessionMessageUid,
} from "@noobot/context-protocol/message/codec";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import { tSystem } from "noobot-i18n/agent/system-text";
import { assertNotAborted, isAbortError } from "../../shared/utils/error-utils.js";
import { emitEvent } from "../../events/index.js";
import { requireActiveModelContext } from "../active-model-context.js";
import {
  acknowledgeMainFlowPhaseSummary,
  peekMainFlowPhaseSummary,
  requestMainFlowSummaryCheckpoint,
} from "../main-flow-control.js";
import { consumeSummaryCheckpointCommand } from "../summary-checkpoint-command.js";
import { appendTurnRuntimeInjectedMessage } from "../turn/turn-context-message-appender.js";

export async function consumePhaseSummaryCommand({ modelState, turn }) {
  const { runtime, modelPort } = modelState;
  const instruction = peekMainFlowPhaseSummary(runtime);
  if (!instruction) return null;
  const { eventListener, abortSignal } = runtime;
  assertNotAborted(abortSignal);
  const blocks = requireActiveModelContext(runtime).messageBlocks;
  const snapshot = capturePhaseSummarySnapshot(blocks);
  const candidates = resolveSummaryScope(snapshot).checkpointMessages;
  const messageKeys = candidates.map(resolveContextMessageKey);
  if (
    !candidates.length ||
    candidates.some((message) => !resolveContextSessionMessageUid(message))
  ) {
    throw new Error("phase summary requires canonical checkpoint targets");
  }
  await emitEvent(eventListener, "phase_summary_model_started", {
    turn,
    source: instruction.source,
  });
  try {
    const response = await modelPort.invoke({
      messages: [
        ...filterForModelContext(
          structuredClone([...snapshot.system, ...snapshot.history, ...snapshot.incremental]),
        ),
        new HumanMessage(instruction.prompt),
      ],
      options: { streaming: true, streamingRequired: true, signal: abortSignal },
      invocation: {
        flow: "agent.main",
        purpose: "phase_summary",
        domain: "primary",
        contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
      },
    });
    assertNotAborted(abortSignal);
    const content = requirePhaseSummaryText(response.output);
    assertPhaseSummaryTargetsUnchanged(snapshot, requireActiveModelContext(runtime).messageBlocks);
    appendTurnRuntimeInjectedMessage({
      runtime,
      content: `${tSystem("context.phaseSummaryTitle", runtime.runConfig.locale)}\n${content}`,
      internalType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
    });

    const { summaryMessages } = resolveSummaryScope(
      requireActiveModelContext(runtime).messageBlocks,
      { messageKeys },
    );
    const summarizedMessageUids = [
      ...new Set(summaryMessages.map(resolveContextSessionMessageUid)),
    ];
    let receiptDelivered = false;
    requestMainFlowSummaryCheckpoint(runtime, {
      source: instruction.source,
      summarizedMessageUids,
      onCommitted: async (checkpoint) => {
        if (!receiptDelivered) {
          await instruction.onCommitted(Object.freeze({ content, ...checkpoint }));
          receiptDelivered = true;
        }
        await emitEvent(eventListener, "phase_summary_completed", {
          turn,
          source: instruction.source,
          markedCount: checkpoint.markedCount,
        });
        acknowledgeMainFlowPhaseSummary(runtime, instruction);
      },
    });
    const checkpoint = await consumeSummaryCheckpointCommand({ runtime, eventListener, turn });
    return Object.freeze({ content, ...checkpoint });
  } catch (error) {
    await emitEvent(eventListener, "phase_summary_failed", {
      turn,
      source: instruction.source,
      message: error.message,
    });
    assertNotAborted(abortSignal);
    if (isAbortError(error, abortSignal)) throw error;
    throw new Error(`Phase summary failed: ${error.message}`, { cause: error });
  }
}
