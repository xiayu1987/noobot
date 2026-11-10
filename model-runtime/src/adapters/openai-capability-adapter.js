/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import OpenAI from "openai";
import { MODEL_OPERATION_KIND, MODEL_WEB_SEARCH_INSTRUCTION } from "@noobot/model-protocol";
import { text } from "@noobot/shared/value";
import { createResponseModeFetch, unwrapModelProtocolError } from "./response-mode.js";
import { collectResponsesStream } from "./openai-responses-stream.js";
import { readOpenAiResponsesResponse } from "./openai-json-response.js";

function resolveResponsesOutputText(result = {}) {
  const sdkOutputText = text(result?.output_text);
  if (sdkOutputText) return sdkOutputText;
  return (Array.isArray(result?.output) ? result.output : [])
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .filter((item) => item?.type === "output_text")
    .map((item) => String(item?.text || ""))
    .join("")
    .trim();
}

function extractResponsesUrlCitations(output = []) {
  const sources = new Map();
  const annotations = (Array.isArray(output) ? output : [])
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .flatMap((part) => (Array.isArray(part?.annotations) ? part.annotations : []));
  for (const annotation of annotations) {
    const url = text(annotation?.url);
    if (annotation?.type !== "url_citation" || !url || sources.has(url)) continue;
    sources.set(url, { title: text(annotation.title), url });
  }
  return [...sources.values()];
}

export function resolveOpenAiOperationStreamingModes() {
  return [false, true];
}

export async function executeOpenAiOperation({ fetch, streaming, ...input }) {
  try {
    return await runOpenAiOperation({
      ...input,
      streaming,
      fetch: createResponseModeFetch({ requestedStreaming: streaming, fetch }),
    });
  } catch (error) {
    throw unwrapModelProtocolError(error);
  }
}

async function runOpenAiOperation({
  modelSpec,
  credential,
  operation,
  streaming,
  headers = {},
  signal,
  fetch,
  mapMultimodalAttachment = mapOpenAiMultimodalAttachment,
  openAiClientFactory = (config) => new OpenAI(config),
}) {
  const client = openAiClientFactory({
    apiKey: credential,
    ...(modelSpec.base_url ? { baseURL: modelSpec.base_url } : {}),
    defaultHeaders: headers,
    fetch,
    maxRetries: 0,
  });
  const createResponse = async (body) => {
    const response = client.responses.create(
      { ...body, stream: streaming },
      { signal: signal || undefined },
    );
    return streaming
      ? collectResponsesStream(await response)
      : readOpenAiResponsesResponse(response, body);
  };
  if (operation.kind === MODEL_OPERATION_KIND.WEB_SEARCH) {
    const result = await createResponse({
      model: modelSpec.model,
      instructions: MODEL_WEB_SEARCH_INSTRUCTION,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: text(operation.input.query) }],
        },
      ],
      tools: [{ type: "web_search" }],
      tool_choice: "required",
    });
    return {
      rawText: resolveResponsesOutputText(result),
      sources: extractResponsesUrlCitations(result?.output),
    };
  }
  if (operation.kind === MODEL_OPERATION_KIND.MULTIMODAL_PARSE) {
    const attachmentContent = operation.input.attachments.map(mapMultimodalAttachment);
    const result = await createResponse({
      model: modelSpec.model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: text(operation.input.prompt) },
            ...attachmentContent,
          ],
        },
      ],
    });
    return {
      rawText: resolveResponsesOutputText(result),
      output: result.output,
    };
  }
  throw new TypeError(`unsupported OpenAI model operation: ${operation.kind}`);
}

function mapOpenAiMultimodalAttachment(attachment = {}) {
  const mimeType = text(attachment.mimeType) || "application/octet-stream";
  const data = text(attachment.data);
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.startsWith("image/")) return { type: "input_image", image_url: data };
  if (normalizedMimeType.startsWith("audio/")) {
    const format = ["audio/wav", "audio/x-wav"].includes(normalizedMimeType) ? "wav" : "mp3";
    const base64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
    return { type: "input_audio", input_audio: { data: base64, format } };
  }
  return {
    type: "input_file",
    file_data: data,
    filename: text(attachment.fileName) || undefined,
  };
}
