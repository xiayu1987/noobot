/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { streamServerSentEvents } from "@noobot/shared/event-stream";
import { ModelProtocolError, createAnthropicStreamTerminalTracker } from "@noobot/model-protocol";

export async function readAnthropicMessageStream(response, { onText, signal }) {
  if (!response.body) throw new ModelProtocolError("missing Anthropic SSE response body");
  const tracker = createAnthropicStreamTerminalTracker({ retainMessage: true });
  for await (const { data } of streamServerSentEvents(response.body)) {
    const event = JSON.parse(data);
    signal?.throwIfAborted();
    const terminal = tracker.accept(event);
    if (terminal?.status === "failed") {
      const error = new Error(event.error?.message || "Anthropic stream failed");
      error.code = event.error?.type;
      throw error;
    }
    if (
      event.type === "content_block_start" &&
      event.content_block.type === "text" &&
      event.content_block.text
    )
      await onText(event.content_block.text);
    if (event.type === "content_block_delta" && event.delta.type === "text_delta")
      await onText(event.delta.text);
    if (terminal?.status === "completed") return tracker.message;
  }
  signal?.throwIfAborted();
  throw new ModelProtocolError(
    "invalid Anthropic message stream: connection ended before message_stop",
  );
}
