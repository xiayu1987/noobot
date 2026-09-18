/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { migrateSessionDocument } from "@noobot/session-repair";
import { normalizeSessionEntity } from "./entities/session-entity.js";

export function normalizeSessionDocumentForCurrentProtocol(document, options = {}) {
  const migration = migrateSessionDocument(document);
  return {
    ...migration,
    document: normalizeSessionEntity(migration.document, options),
  };
}
