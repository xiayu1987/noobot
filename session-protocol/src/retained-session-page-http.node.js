/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { finished } from "node:stream/promises";

export async function sendRetainedSessionPage(res, { cursor, read, send, release }) {
  if (res.destroyed) {
    if (cursor !== null) await release(cursor);
    return;
  }
  const page = await read();
  await writeRetainedSessionPage(res, page, send, release);
}

async function writeRetainedSessionPage(res, page, send, release) {
  let sendFailure;
  try {
    if (!res.destroyed) {
      send(page);
      await finished(res, { cleanup: true });
    }
  } catch (error) {
    sendFailure = { error };
  }
  const cursor = page?.nextCursor;
  if (!res.writableFinished && cursor != null) {
    try {
      await release(cursor);
    } catch (error) {
      if (!sendFailure) throw error;
      throw new AggregateError([sendFailure.error, error], "Page response and release failed", {
        cause: sendFailure.error,
      });
    }
  }
  if (sendFailure && sendFailure.error?.code !== "ERR_STREAM_PREMATURE_CLOSE")
    throw sendFailure.error;
}
