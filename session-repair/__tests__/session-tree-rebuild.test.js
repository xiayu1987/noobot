/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  SESSION_TREE_REJECTION,
  SESSION_TREE_SHAPE,
  buildSessionTree,
  classifySessionTree,
  listSessionTreePlacements,
  rebuildSessionTree,
} from "../src/index.js";

const USER = SESSION_CALLER.USER;
const BOT = SESSION_CALLER.BOT;
const R = SESSION_TREE_REJECTION;

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
    {
      placements: [
        { sessionId: "a", parentSessionId: "", segments: ["runtime/session", "a"] },
        { sessionId: "b", parentSessionId: "a", segments: ["runtime/session", "a", "b"] },
      ],
      rejected: [],
    },
  );
});

test("session tree placements reject only the sessions whose chain is invalid", () => {
  const { placements, rejected } = listSessionTreePlacements({
    nodes: {
      a: { parentSessionId: "" },
      bad: { parentSessionId: 1 },
      "../x": { parentSessionId: "" },
      lost: { parentSessionId: "gone" },
      child: { parentSessionId: "lost" },
      c1: { parentSessionId: "c2" },
      c2: { parentSessionId: "c1" },
    },
  });
  assert.deepEqual(
    placements.map(({ sessionId }) => sessionId),
    ["a"],
  );
  assert.deepEqual(rejected, [
    { sessionId: "bad", reason: R.PLACEMENT_INVALID },
    { sessionId: "../x", reason: R.PLACEMENT_INVALID },
    { sessionId: "lost", reason: R.PARENT_MISSING },
    { sessionId: "child", reason: R.PARENT_REJECTED },
    { sessionId: "c1", reason: R.CYCLE },
    { sessionId: "c2", reason: R.CYCLE },
  ]);
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

function sessionDocument(segments, parentSessionId, caller = USER) {
  return { segments, document: { sessionId: segments.at(-1), parentSessionId, caller } };
}

test("session tree rebuild places nested session documents by their ancestor chain", () => {
  assert.deepEqual(
    rebuildSessionTree([sessionDocument(["a"], ""), sessionDocument(["a", "b"], "a", BOT)]),
    {
      tree: {
        nodes: {
          a: { sessionId: "a", parentSessionId: "", caller: USER },
          b: { sessionId: "b", parentSessionId: "a", caller: BOT },
        },
      },
      repairedCallers: [],
      rejected: [],
    },
  );
});

test("session tree rebuild rejects each unplaceable session and keeps the rest", () => {
  const { tree, rejected } = rebuildSessionTree([
    sessionDocument(["a"], ""),
    { segments: ["broken"], document: null },
    { segments: ["other"], document: { sessionId: "x", parentSessionId: "" } },
    { segments: ["np"], document: { sessionId: "np" } },
    sessionDocument(["dup"], ""),
    sessionDocument(["a", "dup"], "a"),
    sessionDocument(["lost"], "gone"),
    sessionDocument(["lost", "child"], "lost"),
    sessionDocument(["flat"], "a"),
  ]);
  assert.deepEqual(Object.keys(tree.nodes), ["a"]);
  assert.deepEqual(rejected, [
    { sessionId: "broken", reason: R.DOCUMENT_INVALID, segments: ["broken"] },
    { sessionId: "other", reason: R.IDENTITY_MISMATCH, segments: ["other"] },
    { sessionId: "dup", reason: R.DUPLICATE_SESSION, segments: ["a", "dup"] },
    { sessionId: "dup", reason: R.DUPLICATE_SESSION, segments: ["dup"] },
    { sessionId: "np", reason: R.PLACEMENT_INVALID, segments: ["np"] },
    { sessionId: "lost", reason: R.PARENT_MISSING, segments: ["lost"] },
    { sessionId: "child", reason: R.PARENT_REJECTED, segments: ["lost", "child"] },
    { sessionId: "flat", reason: R.DIRECTORY_MISMATCH, segments: ["flat"] },
  ]);
});
