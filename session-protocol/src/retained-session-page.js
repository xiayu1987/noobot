/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function readRetainedSessionPage({ cursor, receive, accept, release }) {
  let releaseCursor = cursor;
  try {
    const { page, ...metadata } = await receive();
    releaseCursor ??= page?.nextCursor;
    return await accept(page, metadata);
  } catch (error) {
    if (releaseCursor != null) await releaseFailedPage(release, releaseCursor, error);
    throw error;
  }
}

async function releaseFailedPage(release, cursor, error) {
  try {
    await release(cursor);
  } catch (releaseError) {
    throw new AggregateError(
      [error, releaseError],
      "Session page request and snapshot release failed",
      { cause: error },
    );
  }
}
