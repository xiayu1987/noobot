/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_CALLER } from "@noobot/shared/session-caller";

export const TEST_ACCEPTED_DIALOG_PROCESS_ID = "dp1";

const REQUIRED_TEST_RUN_FIELDS = Object.freeze(["userId", "sessionId", "message", "turnScopeId"]);

const NEUTRAL_TEST_RUN_FIELDS = Object.freeze({
  attachments: [],
  systemMessages: [],
  eventListener: null,
  caller: SESSION_CALLER.USER,
  parentSessionId: "",
  parentDialogProcessId: "",
  dialogProcessId: "",
  abortSignal: undefined,
  userInteractionBridge: null,
  userInterjectionPort: null,
  runConfig: {},
  turnAcceptance: null,
  parentAsyncResultContainer: null,
  persistenceScope: null,
});

export function createTestSessionRunPayload(fields) {
  const missing = REQUIRED_TEST_RUN_FIELDS.filter((field) => !Object.hasOwn(fields, field));
  if (missing.length) {
    throw new TypeError(`test session run payload requires: ${missing.join(",")}`);
  }
  const unknown = Object.keys(fields).filter(
    (field) =>
      !REQUIRED_TEST_RUN_FIELDS.includes(field) && !Object.hasOwn(NEUTRAL_TEST_RUN_FIELDS, field),
  );
  if (unknown.length) {
    throw new TypeError(`test session run payload has unknown fields: ${unknown.join(",")}`);
  }
  return { ...NEUTRAL_TEST_RUN_FIELDS, ...fields };
}
