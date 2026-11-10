/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

export function partialOutputResponse() {
  return new Response(
    [
      { choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      "[DONE]",
    ]
      .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

export async function consumePartialOutput(fetch) {
  await (
    await fetch("https://provider.test/v1/chat/completions", {
      method: "POST",
      body: "{}",
    })
  ).text();
}

export const invocation = {
  requestId: "r",
  invocationId: "i",
  sessionId: "s",
  parentSessionId: "",
  dialogProcessId: "d",
  turnScopeId: "t",
  runId: "run",
  flow: "test",
  purpose: "test",
  domain: "test",
  contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
};
export const model = {
  model: "m",
  operatorId: "test",
  adapterId: "test",
  capabilities: { web_search: true },
};
