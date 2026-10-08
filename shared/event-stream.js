/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function createEventStreamParser() {
  let line = "";
  let skipLineFeed = false;
  let event = "";
  let data = [];

  function dispatchLine(events) {
    if (!line) {
      if (data.length) events.push({ event: event || "message", data: data.join("\n") });
      event = "";
      data = [];
      return;
    }
    const separator = line.indexOf(":");
    if (separator === 0) return;
    const field = separator < 0 ? line : line.slice(0, separator);
    const raw = separator < 0 ? "" : line.slice(separator + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }

  return function push(text) {
    const events = [];
    for (const character of text) {
      if (skipLineFeed) {
        skipLineFeed = false;
        if (character === "\n") continue;
      }
      if (character === "\r" || character === "\n") {
        skipLineFeed = character === "\r";
        dispatchLine(events);
        line = "";
      } else {
        line += character;
      }
    }
    return events;
  };
}

export async function* streamServerSentEvents(body) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const push = createEventStreamParser();
  for await (const chunk of body) {
    yield* push(decoder.decode(chunk, { stream: true }));
  }
  yield* push(decoder.decode());
}

export function parseServerSentEvents(text) {
  return createEventStreamParser()(String(text));
}
