/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { addOutputText, parseResponse } from "openai/lib/ResponsesParser";
import { requireCompletedResponsesResponse } from "./openai-responses-stream.js";

export async function readOpenAiResponsesResponse(promise, request) {
  const response = await promise.asResponse();
  const result = requireCompletedResponsesResponse(await response.json());
  addOutputText(result);
  const output =
    request.text?.format?.type === "json_schema" ? parseResponse(result, request) : result;
  Object.defineProperty(output, "_request_id", {
    value: response.headers.get("x-request-id"),
    enumerable: false,
  });
  return output;
}
