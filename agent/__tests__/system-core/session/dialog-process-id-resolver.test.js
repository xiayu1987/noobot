/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveDialogProcessId,
  resolveDialogProcessIdFromContext,
  resolveMessageDialogProcessId,
} from "../../../src/system-core/context/session/dialog-process-id-resolver.js";

test("resolveMessageDialogProcessId supports dialogProcessId and dialogId", () => {
  assert.equal(resolveMessageDialogProcessId({ dialogProcessId: "d1" }), "d1");
  assert.equal(resolveMessageDialogProcessId({ dialogId: "d2" }), "d2");
});

test("resolveDialogProcessIdFromContext supports execution dialogProcessId", () => {
  const id = resolveDialogProcessIdFromContext({
    agentContext: {
      execution: {
        dialogProcessId: "d_exec",
      },
    },
  });
  assert.equal(id, "d_exec");
});

test("resolveDialogProcessId falls back to latest message dialogProcessId", () => {
  const id = resolveDialogProcessId({
    ctx: {},
    messages: [{ dialogProcessId: "d_old" }, { dialogProcessId: "d_new" }],
  });
  assert.equal(id, "d_new");
});
