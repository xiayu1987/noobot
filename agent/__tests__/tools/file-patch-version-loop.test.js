/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  test,
  assert,
  fs,
  os,
  path,
  createFileTool,
  buildAgentContext,
  parseToolResult,
} from "./helpers/file-script-length-guards-helper.js";
import { fileContentSha256 } from "../../src/tools/execution/file-mutation-state.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-version-loop-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const tools = new Map(
    createFileTool({ agentContext: buildAgentContext(root) }).map((tool) => [tool.name, tool]),
  );
  return {
    root,
    async read(filePath, options = {}) {
      return parseToolResult(
        await tools.get("read_file").invoke({ filePath, riskLevel: "low", ...options }),
      );
    },
    async patch(body, baseVersions, options = {}) {
      return parseToolResult(
        await tools.get("patch_file").invoke({
          patch: `*** Begin Patch\n${body}\n*** End Patch`,
          baseVersions,
          riskLevel: "low",
          ...options,
        }),
      );
    },
  };
}

const edit = (file, before, after) => `*** Update File: ${file}\n@@\n-${before}\n+${after}`;
const base = (filePath, read) => ({ filePath, sha256: read.baseSha256 });

test("ambiguous later hunk identifies its patch header, writes nothing and recovers by exact anchor", async (t) => {
  const { root, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "first\n");
  const source = "head\nx\ngap\nx\n";
  await fs.writeFile(path.join(root, "b"), source);
  const body = `${edit("a", "first", "FIRST")}\n*** Update File: b\n@@\n-head\n+HEAD\n@@\n-x\n+X`;
  const versions = [base("a", await read("a")), base("b", await read("b"))];
  for (const dryRun of [true, false]) {
    const result = await patch(body, versions, { dryRun });
    assert.equal(result.ok, false);
    assert.equal(result.path.path, "b");
    assert.equal(result.details.hunkIndex, 2);
    assert.equal(result.details.patchLine, 10);
    assert.deepEqual(result.details.candidateLines, [2, 4]);
    assert.equal(result.details.line, undefined);
    assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "first\n");
    assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), source);
  }
  const freshVersions = [base("a", await read("a")), base("b", await read("b"))];
  const corrected = body.replace("@@\n-x", "@@ L4\n-x");
  assert.equal((await patch(corrected, freshVersions)).ok, true);
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "FIRST\n");
  assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), "HEAD\nx\ngap\nX\n");
});

test("context-only scope and consecutive headers reject with a rebuild instruction before any write", async (t) => {
  const { root, read, patch } = await fixture(t);
  const source = "function target() {\n}\nfunction other() {\n}\n";
  await fs.writeFile(path.join(root, "a"), source);
  const versions = [base("a", await read("a"))];
  for (const invalidBody of [
    "*** Update File: a\n@@\n function target() {\n@@\n }\n+insert",
    "*** Update File: a\n@@\n@@ L2\n }\n+insert",
  ]) {
    await assert.rejects(patch(invalidBody, versions), (error) => {
      assert.equal(error.details.patchLine, 3);
      assert.match(error.message, /context-only hunks do not define scope/);
      assert.match(error.message, /keep continuous context with the edit in one hunk/);
      return true;
    });
    assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), source);
  }
  const fresh = await read("a");
  assert.equal(
    (await patch("*** Update File: a\n@@ L2\n }\n+insert", [base("a", fresh)])).ok,
    true,
  );
  assert.equal(
    await fs.readFile(path.join(root, "a"), "utf8"),
    source.replace("}\n", "}\ninsert\n"),
  );
});

test("numbered adaptation and unified ranges retain the submitted patch coordinate on mismatch", async (t) => {
  const { root, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "first\nsecond\n");
  const versions = [base("a", await read("a"))];
  for (const options of [
    {
      patch: "*** Begin Patch\n*** Update File: a\n@@\n-     2\tmissing\n+new\n*** End Patch",
      contentEncoding: "read_file_numbered",
    },
    { patch: "--- a\n+++ a\n@@ -2 +2 @@\n-missing\n+new\n" },
  ]) {
    const result = await patch("", versions, options);
    assert.equal(result.ok, false);
    assert.equal(result.details.hunkIndex, 1);
    assert.equal(result.details.patchLine, 3);
    assert.equal(result.details.line, 2);
    assert.match(result.nearbyContent, /2\tsecond/);
    assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "first\nsecond\n");
  }
});

test("read bytes -> explicit numbered adaptation -> dryRun -> commit returns verifiable hashes", async (t) => {
  const { root, read, patch } = await fixture(t);
  const source = "head\n5\told\n";
  await fs.writeFile(path.join(root, "a"), source);
  const snapshot = await read("a", { startLine: 2, endLine: 2 });
  assert.equal(snapshot.baseSha256, fileContentSha256(Buffer.from(source)));
  const body = edit("a", snapshot.numberedContent, "7\tnew");
  const versions = [base("a", snapshot)];
  const dry = await patch(body, versions, { contentEncoding: "read_file_numbered", dryRun: true });
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), source);
  assert.deepEqual(dry.mutations, []);
  assert.deepEqual(dry.changes[0].adaptations, [
    { kind: "read_file_numbered", line: 2, lineCount: 1 },
  ]);
  const committed = await patch(body, versions, { contentEncoding: "read_file_numbered" });
  assert.deepEqual(committed.changes, dry.changes);
  assert.equal(committed.mutations[0].before.sha256, snapshot.baseSha256);
  assert.equal(committed.mutations[0].after.sha256, dry.changes[0].afterSha256);
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "head\n7\tnew\n");
});

test("stale read is rejected even if patch context still matches, then reread recovers", async (t) => {
  const { root, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "old\ntail\n");
  const stale = await read("a");
  await fs.writeFile(path.join(root, "a"), "old\nexternal\n");
  for (const dryRun of [true, false]) {
    await assert.rejects(patch(edit("a", "old", "new"), [base("a", stale)], { dryRun }), {
      code: "file_mutation_conflict",
    });
  }
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "old\nexternal\n");
  const fresh = await read("a");
  assert.equal((await patch(edit("a", "old", "new"), [base("a", fresh)])).ok, true);
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "new\nexternal\n");
});

test("multi-file planning failure writes nothing", async (t) => {
  const { root, read, patch } = await fixture(t);
  for (const file of ["a", "b"]) await fs.writeFile(path.join(root, file), "old\n");
  const versions = [base("a", await read("a")), base("b", await read("b"))];
  const result = await patch(
    `${edit("a", "old", "new")}\n${edit("b", "missing", "new")}`,
    versions,
  );
  assert.equal(result.ok, false);
  for (const file of ["a", "b"])
    assert.equal(await fs.readFile(path.join(root, file), "utf8"), "old\n");
});

test("version coverage, duplicate versions and stale move destinations are rejected", async (t) => {
  const { root, read, patch } = await fixture(t);
  for (const file of ["a", "b"]) await fs.writeFile(path.join(root, file), "old\n");
  const a = base("a", await read("a"));
  const b = base("b", await read("b"));
  for (const versions of [[], [a, a], [a, { filePath: "unknown", sha256: null }]]) {
    await assert.rejects(patch(edit("a", "old", "new"), versions), /baseVersions/);
  }
  await fs.writeFile(path.join(root, "b"), "external\n");
  await assert.rejects(patch("*** Update File: a\n*** Move to: b", [a, b]), {
    code: "file_mutation_conflict",
  });
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "old\n");
  assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), "external\n");
});

test("add and delete use explicit absent/existing baseline versions", async (t) => {
  const { root, read, patch } = await fixture(t);
  await assert.rejects(patch("*** Add File: a\n+new", []), (error) => {
    assert.equal(error.details.field, "baseVersions");
    assert.match(error.message, /sha256: null for absent targets/);
    return true;
  });
  await assert.rejects(fs.access(path.join(root, "a")), { code: "ENOENT" });
  assert.equal((await patch("*** Add File: a\n+new", [{ filePath: "a", sha256: null }])).ok, true);
  const snapshot = await read("a");
  assert.equal((await patch("*** Delete File: a", [base("a", snapshot)])).ok, true);
  await assert.rejects(fs.access(path.join(root, "a")), { code: "ENOENT" });
});

const move = (source, destination) => `*** Update File: ${source}\n*** Move to: ${destination}`;

for (const reverse of [false, true]) {
  test(`move chains use initial snapshots and return final states (reverse=${reverse})`, async (t) => {
    const { root, read, patch } = await fixture(t);
    await fs.writeFile(path.join(root, "a"), "A\n");
    await fs.writeFile(path.join(root, "b"), "B\n");
    const versions = [
      base("a", await read("a")),
      base("b", await read("b")),
      { filePath: "c", sha256: null },
    ];
    const moves = [move("a", "b"), move("b", "c")];
    const body = (reverse ? moves.reverse() : moves).join("\n");
    const dry = await patch(body, versions, { dryRun: true });
    assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), "B\n");
    const result = await patch(body, versions);
    assert.deepEqual(result.changes, dry.changes);
    assert.equal(result.changes.length, 3);
    assert.equal(result.mutations.length, 3);
    for (const change of result.changes) {
      const file = change.path.path;
      const mutation = result.mutations.find((item) => item.locator.path === file);
      assert.equal(mutation.before.sha256, change.baseSha256);
      assert.equal(mutation.after.sha256, change.afterSha256);
      if (change.action === "delete") {
        await assert.rejects(fs.access(path.join(root, file)), { code: "ENOENT" });
      } else {
        assert.equal(
          fileContentSha256(await fs.readFile(path.join(root, file))),
          change.afterSha256,
        );
      }
    }
    assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), "A\n");
    assert.equal(await fs.readFile(path.join(root, "c"), "utf8"), "B\n");
  });
}

test("move cycles preserve all source bodies with one write per path", async (t) => {
  const { root, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "A\n");
  await fs.writeFile(path.join(root, "b"), "B\n");
  const result = await patch(`${move("a", "b")}\n${move("b", "a")}`, [
    base("a", await read("a")),
    base("b", await read("b")),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 2);
  assert.ok(result.changes.every((change) => change.action === "write"));
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "B\n");
  assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), "A\n");
});

test("duplicate sources, destination collisions and alias collisions fail before writes", async (t) => {
  const { root, read, patch } = await fixture(t);
  for (const name of ["a", "b"]) await fs.writeFile(path.join(root, name), `${name}\n`);
  const versions = [base("a", await read("a")), base("b", await read("b"))];
  for (const body of [
    `${edit("a", "a", "new")}\n${edit("a", "new", "final")}`,
    `${move("a", "b")}\n${edit("b", "b", "new")}`,
    `${edit("a", "a", "new")}\n${edit("./a", "new", "final")}`,
    `${move("a", "b")}\n*** Delete File: a`,
  ]) {
    await assert.rejects(patch(body, versions), /duplicate/);
    assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "a\n");
    assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), "b\n");
  }
});

test("BOM read, failure context, numbered retry and committed bytes share one representation", async (t) => {
  const { root, read, patch } = await fixture(t);
  for (const ending of ["\n", "\r\n", ""]) {
    const source = `\uFEFFold${ending}`;
    await fs.writeFile(path.join(root, "a"), source);
    const snapshot = await read("a");
    assert.equal(snapshot.numberedContent, "     1\told");
    assert.equal(snapshot.baseSha256, fileContentSha256(Buffer.from(source)));
    const versions = [base("a", snapshot)];
    const failed = await patch("*** Update File: a\n@@ L1\n-missing\n+new", versions);
    assert.equal(failed.ok, false);
    assert.equal(failed.nearbyContent, snapshot.numberedContent);
    const body = edit("a", failed.nearbyContent, "new");
    const dry = await patch(body, versions, {
      contentEncoding: "read_file_numbered",
      dryRun: true,
    });
    const result = await patch(body, versions, { contentEncoding: "read_file_numbered" });
    assert.deepEqual(result.changes, dry.changes);
    assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), `\uFEFFnew${ending}`);
  }
});

test("unified newline mismatch aborts a multi-file patch without writing", async (t) => {
  const { root, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "A\n");
  await fs.writeFile(path.join(root, "b"), "B");
  const versions = [base("a", await read("a")), base("b", await read("b"))];
  const diff = "--- a\n+++ a\n@@ -1 +1 @@\n-A\n+new\n--- b\n+++ b\n@@ -1 +1 @@\n-B\n+new\n";
  for (const dryRun of [true, false]) {
    const result = await patch("", versions, { patch: diff, dryRun });
    assert.equal(result.ok, false);
    assert.match(result.error, /newline declaration/);
    assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "A\n");
    assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), "B");
  }
});
