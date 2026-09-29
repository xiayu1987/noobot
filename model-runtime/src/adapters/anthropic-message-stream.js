/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function invalidStream(message) {
  return Object.assign(new Error(`invalid Anthropic message stream: ${message}`), {
    code: "ANTHROPIC_STREAM_INVALID",
  });
}

async function* streamLines(body) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "";
  let skipLineFeed = false;
  for await (const chunk of body) {
    for (const character of decoder.decode(chunk, { stream: true })) {
      if (skipLineFeed) {
        skipLineFeed = false;
        if (character === "\n") continue;
      }
      if (character === "\r" || character === "\n") {
        skipLineFeed = character === "\r";
        yield line;
        line = "";
      } else {
        line += character;
      }
    }
  }
  line += decoder.decode();
  if (line) yield line;
}

async function* streamEvents(body) {
  let data = [];
  for await (const line of streamLines(body)) {
    if (!line) {
      if (data.length) yield JSON.parse(data.join("\n"));
      data = [];
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    if (field !== "data") continue;
    const value = separator < 0 ? "" : line.slice(separator + 1);
    data.push(value.startsWith(" ") ? value.slice(1) : value);
  }
}

async function applyBlockDelta(entry, delta, onText) {
  const block = entry.block;
  switch (delta?.type) {
    case "text_delta":
      if (block.type !== "text" || typeof delta.text !== "string") break;
      block.text += delta.text;
      await onText(delta.text);
      return;
    case "input_json_delta":
      if (
        !["tool_use", "server_tool_use"].includes(block.type) ||
        typeof delta.partial_json !== "string"
      )
        break;
      entry.json += delta.partial_json;
      return;
    case "thinking_delta":
      if (block.type !== "thinking" || typeof delta.thinking !== "string") break;
      block.thinking += delta.thinking;
      return;
    case "signature_delta":
      if (block.type !== "thinking" || typeof delta.signature !== "string") break;
      block.signature = (block.signature || "") + delta.signature;
      return;
    case "citations_delta":
      if (block.type !== "text" || !delta.citation) break;
      block.citations = [...(block.citations || []), delta.citation];
      return;
  }
  throw invalidStream(`unsupported ${delta?.type || "missing delta"} for ${block.type}`);
}

export async function readAnthropicMessageStream(response, { onText, signal }) {
  if (
    !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") ||
    !response.body
  ) {
    await response.body?.cancel();
    throw invalidStream("expected an SSE response body");
  }
  let message = null;
  const openBlocks = new Map();
  for await (const event of streamEvents(response.body)) {
    signal?.throwIfAborted();
    if (event.type === "ping") continue;
    if (event.type === "error") {
      const error = new Error(event.error?.message || "Anthropic stream failed");
      error.code = event.error?.type;
      error.response = event;
      throw error;
    }
    if (event.type === "message_start") {
      if (
        message ||
        !event.message ||
        !Array.isArray(event.message.content) ||
        event.message.content.length
      ) {
        throw invalidStream("unexpected message_start");
      }
      message = { ...event.message, content: [], usage: { ...event.message.usage } };
      continue;
    }
    if (!message) throw invalidStream("missing message_start");
    switch (event.type) {
      case "content_block_start": {
        if (event.index !== message.content.length || !event.content_block?.type) {
          throw invalidStream("unexpected content block index or type");
        }
        const block = { ...event.content_block };
        message.content.push(block);
        openBlocks.set(event.index, { block, json: "" });
        if (block.type === "text" && block.text) await onText(block.text);
        break;
      }
      case "content_block_delta": {
        const entry = openBlocks.get(event.index);
        if (!entry) throw invalidStream("delta without an open content block");
        await applyBlockDelta(entry, event.delta, onText);
        break;
      }
      case "content_block_stop": {
        const entry = openBlocks.get(event.index);
        if (!entry) throw invalidStream("stop without an open content block");
        if (entry.json) entry.block.input = JSON.parse(entry.json);
        openBlocks.delete(event.index);
        break;
      }
      case "message_delta":
        Object.assign(message, event.delta);
        Object.assign(message.usage, event.usage);
        break;
      case "message_stop":
        if (openBlocks.size || !message.stop_reason) {
          throw invalidStream("message_stop before content and stop reason are complete");
        }
        return message;
      default:
        throw invalidStream(`unsupported event: ${event.type}`);
    }
  }
  signal?.throwIfAborted();
  throw invalidStream("connection ended before message_stop");
}
