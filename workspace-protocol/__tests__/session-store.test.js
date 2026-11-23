/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  advanceSessionBranchDeletion,
  requireBranchDeletionDirectoriesAvailable,
  SESSION_DELETION_STAGE,
  SESSION_TOMBSTONE_ERROR,
  sessionBranchDeletionKey,
} from "../src/session-tombstone.js";
import {
  SESSION_STORE_ERROR,
  parseWorkspaceSessionTombstones,
  parseWorkspaceSessionTree,
} from "../src/session-store.js";

const TREE_FILE = "/workspace/admin/runtime/session/session-tree.json";
const TOMBSTONE_FILE = "/workspace/admin/runtime/session/session-tombstones.json";

test("missing session tree means the workspace is not initialized", () => {
  assert.throws(
    () => parseWorkspaceSessionTree({ raw: null, file: TREE_FILE }),
    (error) => {
      assert.equal(error.code, SESSION_STORE_ERROR.WORKSPACE_NOT_INITIALIZED);
      assert.equal(error.details.missingFile, TREE_FILE);
      return true;
    },
  );
});

test("session tree is parsed and normalized", () => {
  const node = { sessionId: "s1", parentSessionId: "", caller: SESSION_CALLER.USER };
  const tree = parseWorkspaceSessionTree({
    raw: JSON.stringify({ nodes: { s1: node } }),
    file: TREE_FILE,
  });
  assert.deepEqual(tree.nodes.s1, node);
});

test("corrupted session tree is a protocol error carrying the file", () => {
  assert.throws(
    () => parseWorkspaceSessionTree({ raw: "{", file: TREE_FILE }),
    (error) => {
      assert.equal(error.code, SESSION_STORE_ERROR.CORRUPTED);
      assert.equal(error.details.file, TREE_FILE);
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    },
  );
});

test("missing tombstone file means no session has been deleted", () => {
  assert.deepEqual(parseWorkspaceSessionTombstones({ raw: null, file: TOMBSTONE_FILE }), {});
});

test("tombstone sessions are parsed and invalid tombstones are rejected", () => {
  assert.deepEqual(
    parseWorkspaceSessionTombstones({
      raw: JSON.stringify({ sessions: { s1: 1 } }),
      file: TOMBSTONE_FILE,
    }),
    { s1: 1 },
  );
  assert.throws(
    () =>
      parseWorkspaceSessionTombstones({
        raw: JSON.stringify({ sessions: { s1: "x" } }),
        file: TOMBSTONE_FILE,
      }),
    { code: SESSION_TOMBSTONE_ERROR.INVALID },
  );
  assert.throws(() => parseWorkspaceSessionTombstones({ raw: "{", file: TOMBSTONE_FILE }), {
    code: SESSION_STORE_ERROR.CORRUPTED,
  });
});

test("pending recursive cleanup owns overlapping directories in either direction", () => {
  const parent = { sessionId: "parent", directory: ["runtime", "session", "parent"] };
  const child = { sessionId: "child", directory: [...parent.directory, "child"] };
  for (const [pending, requested] of [
    [child, parent],
    [parent, child],
  ]) {
    const deletionKey = sessionBranchDeletionKey([pending.sessionId]);
    const operation = {
      targets: [pending],
      pluginHandlerIds: [],
      nextStage: SESSION_DELETION_STAGE.DIRECTORIES,
    };
    const state = {
      sessions: { [pending.sessionId]: 1 },
      branchDeletions: { [deletionKey]: operation },
    };
    assert.throws(() => requireBranchDeletionDirectoriesAvailable(state, [requested]), {
      code: SESSION_TOMBSTONE_ERROR.DELETION_CONFLICT,
      statusCode: 409,
      details: { sessionId: requested.sessionId, deletionKey, pendingSessionId: pending.sessionId },
    });
    requireBranchDeletionDirectoriesAvailable(state, [
      { sessionId: "parent-other", directory: ["runtime", "session", "parent-other"] },
    ]);
    operation.nextStage = SESSION_DELETION_STAGE.TREE;
    requireBranchDeletionDirectoriesAvailable(state, [requested]);
  }
});

test("branch deletion advances only the persisted stage that cleanup completed", () => {
  const operation = {
    targets: [{ sessionId: "s1", directory: ["runtime", "session", "s1"] }],
    pluginHandlerIds: ["handler"],
    nextStage: SESSION_DELETION_STAGE.TREE,
  };
  const next = advanceSessionBranchDeletion(operation, SESSION_DELETION_STAGE.TREE);
  assert.deepEqual(next, { ...operation, nextStage: SESSION_DELETION_STAGE.PLUGINS });
  assert.equal(operation.nextStage, SESSION_DELETION_STAGE.TREE);
  for (const stage of [undefined, "directories", "plugins", "complete"]) {
    assert.throws(() => advanceSessionBranchDeletion(operation, stage), {
      code: SESSION_TOMBSTONE_ERROR.DELETION_CONFLICT,
      statusCode: 409,
    });
  }
  assert.throws(() => advanceSessionBranchDeletion(undefined, "directories"), {
    code: SESSION_TOMBSTONE_ERROR.INVALID,
  });
  assert.throws(
    () => advanceSessionBranchDeletion({ ...operation, nextStage: "complete" }, "complete"),
    TypeError,
  );
});

test("session store requires a file and raw content that is a string or null", () => {
  assert.throws(() => parseWorkspaceSessionTree({ raw: null, file: "" }), TypeError);
  assert.throws(() => parseWorkspaceSessionTombstones({ raw: null, file: undefined }), TypeError);
  assert.throws(() => parseWorkspaceSessionTree({ raw: undefined, file: TREE_FILE }), TypeError);
  assert.throws(
    () => parseWorkspaceSessionTombstones({ raw: {}, file: TOMBSTONE_FILE }),
    TypeError,
  );
});
