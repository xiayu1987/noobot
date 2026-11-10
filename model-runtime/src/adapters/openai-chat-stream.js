/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createChatStreamTerminalTracker, ModelProtocolError } from "@noobot/model-protocol";
import { createEventStreamParser } from "@noobot/shared/event-stream";
import {
  createModelResponseDecoder,
  parseModelResponseJson,
} from "../normalization/response-decoding.js";

export function guardChatResponseStream(response) {
  const tracker = createChatStreamTerminalTracker();
  const parseFrames = createEventStreamParser();
  const decode = createModelResponseDecoder();
  const reader = response.body.getReader();
  let terminal = null;
  const requireCompleted = () => {
    if (tracker.end().status !== "completed")
      throw new ModelProtocolError(
        "Chat stream requires finish_reason for every choice and [DONE]",
      );
  };
  const acceptChunk = (bytes, done) => {
    if (terminal) return;
    for (const { data } of parseFrames(decode(bytes, { stream: !done }))) {
      const event = data === "[DONE]" ? { type: data } : parseModelResponseJson(data);
      terminal = tracker.accept(event);
      if (data === "[DONE]") requireCompleted();
      if (terminal) return;
    }
    if (done) requireCompleted();
  };
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        acceptChunk(chunk.value, chunk.done);
        if (chunk.done) {
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
        await reader.cancel(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
