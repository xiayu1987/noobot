/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  SESSION_TREE_SHAPE,
  SESSION_TREE_UNRECOVERABLE,
  buildSessionTree,
  classifySessionTree,
  listSessionTreePlacements,
  rebuildSessionTree,
} from "../src/index.js";

const USER = SESSION_CALLER.USER;
const BOT = SESSION_CALLER.BOT;

test("session tree shape classification separates legacy, parent-only and current trees", () => {
  assert.equal(classifySessionTree("{bad"), SESSION_TREE_SHAPE.INVALID);
  assert.equal(classifySessionTree({ nodes: { s: null } }), SESSION_TREE_SHAPE.INVALID);
  assert.equal(classifySessionTree({ nodes: {}, updatedAt: "t" }), SESSION_TREE_SHAPE.LEGACY);
  assert.equal(classifySessionTree({ roots: [], nodes: {} }), SESSION_TREE_SHAPE.LEGACY);
  assert.equal(
    classifySessionTree({ nodes: { s: { sessionId: "s", parentSessionId: "" } } }),
    SESSION_TREE_SHAPE.PARENT_ONLY,
  );
  assert.equal(
    classifySessionTree({ nodes: { s: { sessionId: "s", parentSessionId: "", caller: USER } } }),
    SESSION_TREE_SHAPE.CURRENT,
  );
});

test("session tree placements follow the persisted parent chain", () => {
  assert.deepEqual(
    listSessionTreePlacements({
      roots: ["a"],
      nodes: { a: { parentSessionId: "", children: ["b"] }, b: { parentSessionId: "a" } },
    }),
    [
      { sessionId: "a", parentSessionId: "", segments: ["runtime/session", "a"] },
      { sessionId: "b", parentSessionId: "a", segments: ["runtime/session", "a", "b"] },
    ],
  );
  for (const tree of [
    { nodes: { a: { parentSessionId: 1 } } },
    { nodes: { a: { parentSessionId: "gone" } } },
    { nodes: { "../a": { parentSessionId: "" } } },
  ]) {
    assert.throws(() => listSessionTreePlacements(tree), { code: SESSION_TREE_UNRECOVERABLE });
  }
});

test("session tree build takes caller from session documents and repairs it explicitly", () => {
  assert.deepEqual(
    buildSessionTree([
      { sessionId: "a", parentSessionId: "", document: { caller: USER } },
      { sessionId: "b", parentSessionId: "a", document: { caller: BOT } },
      { sessionId: "c", parentSessionId: "a", document: null },
      { sessionId: "d", parentSessionId: "a", document: { caller: "admin" } },
    ]),
    {
      tree: {
        nodes: {
          a: { sessionId: "a", parentSessionId: "", caller: USER },
          b: { sessionId: "b", parentSessionId: "a", caller: BOT },
          c: { sessionId: "c", parentSessionId: "a", caller: USER },
          d: { sessionId: "d", parentSessionId: "a", caller: USER },
        },
      },
      repairedCallers: ["c", "d"],
    },
  );
});

test("session tree rebuild requires recoverable session documents", () => {
  assert.deepEqual(
    rebuildSessionTree([
      { directoryName: "a", document: { sessionId: "a", parentSessionId: "", caller: USER } },
      { directoryName: "b", document: { sessionId: "b", parentSessionId: "a", caller: BOT } },
    ]).tree,
    {
      nodes: {
        a: { sessionId: "a", parentSessionId: "", caller: USER },
        b: { sessionId: "b", parentSessionId: "a", caller: BOT },
      },
    },
  );
  for (const documents of [
    [{ directoryName: "a", document: null }],
    [{ directoryName: "a", document: { sessionId: "other" } }],
    [{ directoryName: "a", document: { sessionId: "a", parentSessionId: 1 } }],
    [{ directoryName: "a", document: { sessionId: "a" } }],
    [{ directoryName: "b", document: { sessionId: "b", parentSessionId: "missing" } }],
  ]) {
    assert.throws(() => rebuildSessionTree(documents), { code: SESSION_TREE_UNRECOVERABLE });
  }
});
