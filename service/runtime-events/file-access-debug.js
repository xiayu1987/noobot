/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FILE_ACCESS_DEBUG_TYPE, FILE_TRACE_ID_HEADER } from "@noobot/shared/runtime-events-config";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { text } from "@noobot/shared/value";

export function recordFileAccessDebug(req, { event, traceEvent, data = {} } = {}) {
  const traceId = text(req?.headers?.[FILE_TRACE_ID_HEADER]);
  if (!traceId) return;
  void writeRuntimeEvent({
    scope: "system",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: FILE_ACCESS_DEBUG_TYPE,
    event,
    data: {
      traceEvent,
      traceIdLength: traceId.length,
      ...data,
    },
  });
}
