/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExecutionForest,
  buildExecutionTree,
  selectExecutionRelations,
} from "@noobot/session-protocol/execution-lifecycle";

const execution = (executionId, parentExecutionId = "") => ({ executionId, parentExecutionId });

test("execution relations preserve breadth-first order, references and cross-session ownership", () => {
  const records = [
    execution("root", "external"),
    { ...execution("grandchild", "child"), sessionId: "sub" },
    { ...execution("child", "root"), sessionId: "main" },
    execution("sibling", "root"),
  ].map(Object.freeze);
  const directory = Object.freeze(
    Object.fromEntries(records.map((item) => [item.executionId, item])),
  );
  assert.deepEqual(selectExecutionRelations(directory, "root"), [records[2], records[3]]);
  const descendants = selectExecutionRelations(directory, "root", { descendants: true });
  assert.deepEqual(descendants, [records[2], records[3], records[1]]);
  assert.equal(descendants[2], records[1]);
  assert.deepEqual(selectExecutionRelations(directory, "absent"), []);
  assert.deepEqual(selectExecutionRelations(directory, "external"), []);
  assert.deepEqual(selectExecutionRelations(directory, "grandchild"), []);
});

test("execution relations reject malformed queries, directory keys and disconnected cycles", () => {
  for (const query of [undefined, "", " root", null]) {
    assert.throws(() => selectExecutionRelations({}, query), TypeError);
  }
  for (const directory of [
    null,
    [],
    { wrong: execution("root") },
    { root: null },
    { root: { executionId: "root" } },
    { a: execution("a", "b"), b: execution("b", "a") },
  ]) {
    assert.throws(() => selectExecutionRelations(directory, "absent"), TypeError);
  }
});

test("execution forest preserves directory order, external parent boundaries and source facts", () => {
  const sources = Object.freeze([
    Object.freeze(execution("grandchild", "child")),
    Object.freeze(execution("root", "external")),
    Object.freeze(execution("child", "root")),
    Object.freeze(execution("other")),
  ]);
  const forest = buildExecutionForest(sources);
  assert.deepEqual(forest.rootExecutionIds, ["root", "other"]);
  assert.deepEqual(forest.executions.root.childExecutionIds, ["child"]);
  assert.deepEqual(forest.executions.child.childExecutionIds, ["grandchild"]);
  assert.equal(forest.executions.root.parentExecutionId, "external");
  assert.equal(Object.hasOwn(sources[0], "childExecutionIds"), false);
  assert.deepEqual(buildExecutionForest([]), { executions: {}, rootExecutionIds: [] });
});

test("execution forest rejects malformed directories without filling missing identity", () => {
  for (const directory of [
    undefined,
    null,
    {},
    [null],
    [[]],
    [{}],
    [execution(" a")],
    [{ executionId: "a" }],
    [execution("a", null)],
    [execution("a", " b")],
  ]) {
    assert.throws(() => buildExecutionForest(directory), TypeError);
  }
});

test("execution forest rejects duplicate identities, self parents and disconnected cycles", () => {
  for (const directory of [
    [execution("a"), execution("a")],
    [execution("a", "a")],
    [execution("a", "b"), execution("b", "a")],
    [execution("root"), execution("a", "b"), execution("b", "a"), execution("leaf", "b")],
  ]) {
    assert.throws(() => buildExecutionForest(directory), /duplicate executionId|parent cycle/);
  }
});

test("authoritative execution trees use the same duplicate and cycle contract", () => {
  const record = (id, parent) => ({
    ...execution(id, parent),
    executionKind: "workflow",
    rootExecutionId: "root",
    revision: 1,
    sequence: 1,
  });
  assert.throws(
    () => buildExecutionTree([record("root", ""), record("root", "")]),
    /duplicate executionId/,
  );
  assert.throws(() => buildExecutionTree([record("a", "b"), record("b", "a")]), /parent cycle/);
});
