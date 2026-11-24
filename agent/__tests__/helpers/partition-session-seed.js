/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { initializePartitionReaderFixture } from "./partition-reader-fixture.js";
import { projectionSession } from "./session-projection-fixture.js";

export function seedPartitionSession({ sessionPayload, sessionDir }) {
  return initializePartitionReaderFixture({
    sessionDir,
    session: projectionSession(sessionPayload),
  });
}
