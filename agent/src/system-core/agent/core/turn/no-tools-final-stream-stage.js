/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { maybeInvokeFinalStreamingNoTools } from "./turn-stage.js";

export async function finalizeNoToolsStreamingTurn({
  modelState,
  messages = [],
  modelResponse = null,
  responseContentText = "",
  turn,
  forceToolChoiceNone = false,
} = {}) {
  const mode = forceToolChoiceNone
    ? "final_stream_no_tools_forced_none"
    : "final_stream_no_tools";
  const finalStreamResult = await maybeInvokeFinalStreamingNoTools({
    modelState,
    baseMessages: messages,
    fallbackAi: modelResponse,
    fallbackText: responseContentText,
    turn,
    mode,
  });
  const finalizedModelResponse = finalStreamResult.ai || modelResponse;
  const finalizedResponseContentText = finalStreamResult.text || responseContentText;
  messages.push(finalizedModelResponse);

  return {
    modelResponse: finalizedModelResponse,
    responseContentText: finalizedResponseContentText,
    finalStreamResult,
  };
}
