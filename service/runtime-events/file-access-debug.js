/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FILE_ACCESS_DEBUG_TYPE, FILE_TRACE_ID_HEADER } from "@noobot/shared/runtime-events-config";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

export function recordFileAccessDebug(req, { event, traceEvent, data = {} } = {}) {
  const traceId = String(req?.headers?.[FILE_TRACE_ID_HEADER] || "").trim();
  if (!traceId) return;
  void writeRoutedRuntimeEvent({
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
