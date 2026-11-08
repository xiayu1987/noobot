/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ModelProtocolError } from "./error.js";
import { requireModelResponseTerminal, resolveModelStreamTerminal } from "./measurement.js";

function invalidStream(message) {
  return new ModelProtocolError(`invalid Anthropic message stream: ${message}`);
}

function applyBlockDelta(entry, delta, retainMessage) {
  const block = entry.block;
  switch (delta?.type) {
    case "text_delta":
      if (block.type !== "text" || typeof delta.text !== "string") break;
      if (retainMessage) block.text += delta.text;
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
      if (retainMessage) block.thinking += delta.thinking;
      return;
    case "signature_delta":
      if (block.type !== "thinking" || typeof delta.signature !== "string") break;
      if (retainMessage) block.signature = (block.signature || "") + delta.signature;
      return;
    case "citations_delta":
      if (block.type !== "text" || !delta.citation) break;
      if (retainMessage) block.citations = [...(block.citations || []), delta.citation];
      return;
  }
  throw invalidStream(`unsupported ${delta?.type || "missing delta"} for ${block.type}`);
}

export function createAnthropicStreamTerminalTracker({ retainMessage = false } = {}) {
  let message = null;
  let blockCount = 0;
  let terminal = null;
  const openBlocks = new Map();
  function applyEvent(event) {
    switch (event.type) {
      case "content_block_start": {
        if (event.index !== blockCount || !event.content_block?.type)
          throw invalidStream("unexpected content block index or type");
        const block = retainMessage
          ? { ...event.content_block }
          : { type: event.content_block.type };
        if (retainMessage) message.content.push(block);
        openBlocks.set(event.index, { block, json: "" });
        blockCount += 1;
        break;
      }
      case "content_block_delta": {
        const entry = openBlocks.get(event.index);
        if (!entry) throw invalidStream("delta without an open content block");
        applyBlockDelta(entry, event.delta, retainMessage);
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
        if (retainMessage) {
          Object.assign(message, event.delta);
          Object.assign(message.usage, event.usage);
        } else if (event.delta && Object.hasOwn(event.delta, "stop_reason"))
          message.stop_reason = event.delta.stop_reason;
        break;
      case "message_stop":
        if (openBlocks.size)
          throw invalidStream("message_stop before content and stop reason are complete");
        terminal = requireModelResponseTerminal("anthropic", message);
        break;
      default:
        throw invalidStream(`unsupported event: ${event.type}`);
    }
  }
  return {
    get message() {
      return message;
    },
    accept(event) {
      if (terminal) return terminal;
      if (event.type === "ping") return null;
      terminal = resolveModelStreamTerminal("anthropic", event);
      if (terminal) return terminal;
      if (event.type === "message_start") {
        if (
          message ||
          !event.message ||
          !Array.isArray(event.message.content) ||
          event.message.content.length
        )
          throw invalidStream("unexpected message_start");
        message = retainMessage
          ? { ...event.message, content: [], usage: { ...event.message.usage } }
          : { stop_reason: event.message.stop_reason };
        return null;
      }
      if (!message) throw invalidStream("missing message_start");
      applyEvent(event);
      return terminal;
    },
  };
}
