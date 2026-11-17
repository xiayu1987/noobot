/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { IMMUTABLE_JSON_LOCATED_SESSION_FORMAT } from "@noobot/session-protocol/immutable-record-location";
import { immutableOfflineBackend } from "../../src/session/session-artifact-session/immutable-storage-backends.js";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";

export class JsonLocatedFixture extends immutableOfflineBackend(
  IMMUTABLE_JSON_LOCATED_SESSION_FORMAT,
) {
  beginCommit(snapshot) {
    return ImmutableLocatedRecordStore.prototype.beginCommit.call(this, snapshot);
  }

  encodeLocationPage(page) {
    return Buffer.from(JSON.stringify(page));
  }
}
