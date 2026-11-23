/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  authorityOutboxCommittedPageWindow,
  requireAuthorityOutboxMigrationPage,
} from "@noobot/event-protocol/outbox";

export async function* readMigrationOutboxPages(source, { limit, tail }, signal) {
  let after = 0;
  authorityOutboxCommittedPageWindow({ after, limit, tail });
  while (after < tail) {
    signal?.throwIfAborted();
    const page = await source.readMigrationOutboxPage({ after, limit });
    signal?.throwIfAborted();
    requireAuthorityOutboxMigrationPage(page, { after, limit, tail });
    after = page.cursor;
    yield page;
  }
}
