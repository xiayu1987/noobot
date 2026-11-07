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
import {
  applyFileMutation,
  rollbackFileMutation,
  readFileMutation,
} from "../../src/tools/execution/file-mutation-service.js";
import { fileContentSha256 } from "../../src/tools/execution/file-mutation-state.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-text-fidelity-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const tools = new Map(
    createFileTool({ agentContext: buildAgentContext(root) }).map((tool) => [tool.name, tool]),
  );
  const invoke = async (name, args) =>
    parseToolResult(await tools.get(name).invoke({ riskLevel: "low", ...args }));
  const patch = async (body, baseVersions, options = {}) =>
    invoke("patch_file", {
      patch: `*** Begin Patch\n${body}\n*** End Patch`,
      baseVersions,
      ...options,
    });
  return { root, invoke, patch };
}

const base = (filePath, bytes) => ({ filePath, sha256: fileContentSha256(bytes) });

for (const source of ["one\r\ntwo\nthree\r\n", "\uFEFFone\ntwo\r\nthree", "\uFEFF", "", "a\r"]) {
  test(`pure move preserves exact bytes: ${JSON.stringify(source)}`, async (t) => {
    const { root, patch } = await fixture(t);
    const bytes = Buffer.from(source);
    await fs.writeFile(path.join(root, "a"), bytes);
    const versions = [base("a", bytes), { filePath: "b", sha256: null }];
    const body = "*** Update File: a\n*** Move to: b";
    const dry = await patch(body, versions, { dryRun: true });
    assert.deepEqual(await fs.readFile(path.join(root, "a")), bytes);
    const result = await patch(body, versions);
    assert.deepEqual(result.changes, dry.changes);
    assert.deepEqual(await fs.readFile(path.join(root, "b")), bytes);
    assert.equal(
      result.changes.find((item) => item.action === "write").afterSha256,
      fileContentSha256(bytes),
    );
    await assert.rejects(fs.access(path.join(root, "a")), { code: "ENOENT" });
  });
}

test("patch preserves unchanged mixed line terminators including hunk context", async (t) => {
  const { root, patch } = await fixture(t);
  const bytes = Buffer.from("\uFEFFhead\r\ncontext\ntarget\r\ntail\n");
  await fs.writeFile(path.join(root, "a"), bytes);
  const body = "*** Update File: a\n@@ L2\n context\n-target\n+new\n tail";
  const result = await patch(body, [base("a", bytes)]);
  assert.equal(result.ok, true);
  assert.deepEqual(
    await fs.readFile(path.join(root, "a")),
    Buffer.from("\uFEFFhead\r\ncontext\nnew\r\ntail\n"),
  );
});

test("invalid UTF-8 read, move and edit fail before any file is written", async (t) => {
  const { root, invoke, patch } = await fixture(t);
  const bytes = Buffer.from([0x61, 0xff, 0x0a]);
  await fs.writeFile(path.join(root, "a"), bytes);
  await fs.writeFile(path.join(root, "b"), "old\n");
  await assert.rejects(invoke("read_file", { filePath: "a" }), /valid UTF-8/);
  for (const dryRun of [true, false]) {
    for (const body of [
      "*** Update File: a\n*** Move to: c",
      "*** Update File: a\n@@\n-a�\n+new",
    ]) {
      await assert.rejects(
        patch(
          `*** Update File: b\n@@\n-old\n+new\n${body}`,
          [
            base("a", bytes),
            base("b", Buffer.from("old\n")),
            ...(body.includes("Move") ? [{ filePath: "c", sha256: null }] : []),
          ],
          { dryRun },
        ),
        /valid UTF-8/,
      );
      assert.deepEqual(await fs.readFile(path.join(root, "a")), bytes);
      assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), "old\n");
      await assert.rejects(fs.access(path.join(root, "c")), { code: "ENOENT" });
    }
  }
});

for (const finalNewline of [false, true]) {
  test(`partial read metadata constructs a valid unified EOF edit (finalNewline=${finalNewline})`, async (t) => {
    const { root, invoke } = await fixture(t);
    const source = `head\r\nold${finalNewline ? "\n" : ""}`;
    await fs.writeFile(path.join(root, "a"), source);
    const snapshot = await invoke("read_file", { filePath: "a", startLine: 1, endLine: 1 });
    assert.equal(snapshot.textFormat.finalNewline, finalNewline);
    assert.equal(snapshot.textFormat.lineEnding, finalNewline ? "mixed" : "crlf");
    const marker = snapshot.textFormat.finalNewline ? "" : "\\ No newline at end of file\n";
    const result = await invoke("patch_file", {
      patch: `--- a\n+++ a\n@@ -2 +2 @@\n-old\n${marker}+new\n`,
      baseVersions: [{ filePath: "a", sha256: snapshot.baseSha256 }],
    });
    assert.equal(result.ok, true);
    assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "head\r\nnew\r\n");
  });
}

for (const bytes of [
  Buffer.from("\uFEFF原始\r\n", "utf16le"),
  Buffer.from("\uFEFFa\r\nb\n"),
  Buffer.from([0, 1, 2]),
]) {
  for (const operation of ["replace", "delete"]) {
    test(`rollback restores raw bytes after ${operation}: ${bytes.toString("hex")}`, async (t) => {
      const { root } = await fixture(t);
      const filePath = path.join(root, "a");
      const mutationRoot = path.join(root, "records");
      await fs.writeFile(filePath, bytes);
      const restoreState = {};
      const result = await applyFileMutation({
        filePath,
        locator: { view: "workspace", path: "a" },
        mutationRoot,
        operation,
        content: operation === "delete" ? null : "new\n",
        sessionScope: null,
        rollbackState: restoreState,
        stageBytes: (target, content) => fs.writeFile(target, content),
      });
      assert.equal(result.mutations[0].before.isText, true);
      await rollbackFileMutation({
        filePath,
        mutationRoot,
        mutationId: result.mutations[0].id,
        restoreState,
      });
      assert.deepEqual(await fs.readFile(filePath), bytes);
      assert.equal(
        fileContentSha256(await fs.readFile(filePath)),
        result.mutations[0].before.sha256,
      );
      await assert.rejects(readFileMutation({ mutationRoot, mutationId: result.mutations[0].id }), {
        code: "file_mutation_not_found",
      });
    });
  }
}

test("record persistence failure restores original UTF-16 bytes in the automatic rollback path", async (t) => {
  const { root } = await fixture(t);
  const filePath = path.join(root, "a");
  const bytes = Buffer.from("\uFEFF原始\r\n", "utf16le");
  const mutationRoot = path.join(root, "records");
  await fs.writeFile(filePath, bytes);
  await assert.rejects(
    applyFileMutation({
      filePath,
      locator: { view: "workspace", path: "a" },
      mutationRoot,
      content: "new\n",
      sessionScope: null,
      async stageBytes(target, content) {
        await fs.writeFile(target, content, "utf8");
        await fs.rm(mutationRoot, { recursive: true });
        await fs.writeFile(mutationRoot, "block record persistence");
      },
    }),
    { code: "file_mutation_commit_failed" },
  );
  assert.deepEqual(await fs.readFile(filePath), bytes);
});

test("200000-line move and edits preserve bytes through dryRun and commit", async (t) => {
  const { root, patch } = await fixture(t);
  let source = "line\n".repeat(200000);
  await fs.writeFile(path.join(root, "a"), source);
  const move = "*** Update File: a\n*** Move to: b";
  const versions = [base("a", Buffer.from(source)), { filePath: "b", sha256: null }];
  const dry = await patch(move, versions, { dryRun: true });
  const result = await patch(move, versions);
  assert.deepEqual(result.changes, dry.changes);
  assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), source);
  await assert.rejects(fs.access(path.join(root, "a")), { code: "ENOENT" });
  for (const line of [1, 150001]) {
    const body = `*** Update File: b\n@@ L${line}\n-line\n+changed`;
    const editVersions = [base("b", Buffer.from(source))];
    const editDry = await patch(body, editVersions, { dryRun: true });
    const edit = await patch(body, editVersions);
    assert.deepEqual(edit.changes, editDry.changes);
    const lines = source.split("\n");
    lines[line - 1] = "changed";
    source = lines.join("\n");
    assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), source);
  }
});

test("malformed Unicode additions fail identically before dryRun and commit", async (t) => {
  const { root, patch } = await fixture(t);
  for (const dryRun of [true, false]) {
    await assert.rejects(
      patch("*** Add File: a\n+\ud800", [{ filePath: "a", sha256: null }], { dryRun }),
      /well-formed/,
    );
    await assert.rejects(fs.access(path.join(root, "a")), { code: "ENOENT" });
  }
});
