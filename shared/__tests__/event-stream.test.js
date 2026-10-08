/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseServerSentEvents, streamServerSentEvents } from "../event-stream.js";

async function decode(chunks) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const events = [];
  for await (const event of streamServerSentEvents(body)) events.push(event);
  return events;
}

for (const [name, eol] of [
  ["LF", "\n"],
  ["CRLF", "\r\n"],
  ["CR", "\r"],
]) {
  test(`event stream dispatches ${name}-terminated events`, async () => {
    const stream = `: comment${eol}event: endpoint${eol}data: /messages${eol}${eol}data: a${eol}data:b${eol}${eol}`;
    assert.deepEqual(await decode([stream]), [
      { event: "endpoint", data: "/messages" },
      { event: "message", data: "a\nb" },
    ]);
  });
}

test("event stream keeps CRLF intact across chunk boundaries", async () => {
  assert.deepEqual(await decode(["event: endpoint\r", "\ndata: /m\r\n\r", "\n"]), [
    { event: "endpoint", data: "/m" },
  ]);
});

test("event stream drops an unterminated trailing event", async () => {
  assert.deepEqual(await decode(["data: done\n\ndata: partial"]), [
    { event: "message", data: "done" },
  ]);
});

test("text and stream entries share one parser", async () => {
  const text = "event: a\rdata: 1\rdata: 2\r\r: c\r\ndata:3\r\n\r\ndata: tail";
  const expected = [
    { event: "a", data: "1\n2" },
    { event: "message", data: "3" },
  ];
  assert.deepEqual(parseServerSentEvents(text), expected);
  assert.deepEqual(await decode([text]), expected);
});

test("event stream rejects invalid UTF-8", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0x64, 0x61, 0x74, 0x61, 0x3a, 0xff, 0x0a, 0x0a]));
      controller.close();
    },
  });
  await assert.rejects(streamServerSentEvents(body).next(), TypeError);
});
