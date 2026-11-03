/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_ERROR_CODE, MODEL_ERROR_KIND, ModelProtocolError } from "@noobot/model-protocol";
import { isFunction, isObjectLike } from "@noobot/shared/value";

const EVENT_STREAM_MEDIA_TYPE = "text/event-stream";

export function responseMediaType(response) {
  return String(response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

export async function assertResponseMode({ requestedStreaming, response }) {
  if (typeof requestedStreaming !== "boolean") {
    throw new TypeError("requestedStreaming must be boolean");
  }
  if (!response.ok) return response;
  const mediaType = responseMediaType(response);
  if ((mediaType === EVENT_STREAM_MEDIA_TYPE) === requestedStreaming) return response;
  await response.body?.cancel();
  const requested = requestedStreaming ? "stream" : "non-stream";
  throw new ModelProtocolError(
    `provider response mode does not match the request: requested ${requested}, received ${
      mediaType || "no content-type"
    }`,
    {
      code: MODEL_ERROR_CODE.RESPONSE_MODE_MISMATCH,
      kind: MODEL_ERROR_KIND.RESPONSE_MODE_MISMATCH,
      details: { requestedStreaming, mediaType, status: response.status },
    },
  );
}

export function createResponseModeFetch({ requestedStreaming, fetch: transportFetch }) {
  if (typeof requestedStreaming !== "boolean") {
    throw new TypeError("requestedStreaming must be boolean");
  }
  if (!isFunction(transportFetch)) throw new TypeError("fetch must be a function");
  return async (url, init) =>
    assertResponseMode({ requestedStreaming, response: await transportFetch(url, init) });
}

export function unwrapModelProtocolError(error) {
  const seen = new Set();
  for (let current = error; isObjectLike(current); current = current.cause) {
    if (current instanceof ModelProtocolError) return current;
    if (seen.has(current)) break;
    seen.add(current);
  }
  return error;
}
