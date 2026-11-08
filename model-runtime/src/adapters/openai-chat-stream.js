/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createChatStreamTerminalTracker, ModelProtocolError } from "@noobot/model-protocol";
import { createEventStreamParser } from "@noobot/shared/event-stream";

export function guardChatResponseStream(response) {
  const tracker = createChatStreamTerminalTracker();
  const parseFrames = createEventStreamParser();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = response.body.getReader();
  let terminal = null;
  const requireCompleted = () => {
    if (tracker.end().status !== "completed")
      throw new ModelProtocolError(
        "Chat stream requires finish_reason for every choice and [DONE]",
      );
  };
  const acceptChunk = (bytes) => {
    if (terminal) return;
    for (const { data } of parseFrames(decoder.decode(bytes, { stream: true }))) {
      const event = data === "[DONE]" ? { type: data } : JSON.parse(data);
      terminal = tracker.accept(event);
      if (data === "[DONE]") requireCompleted();
      if (terminal) return;
    }
  };
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done && !terminal) requireCompleted();
        if (chunk.done) {
          controller.close();
          return;
        }
        acceptChunk(chunk.value);
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
