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
import { FILE_TEXT_ENCODINGS } from "@noobot/file-mutation-protocol";
import { encodeFileText } from "@noobot/file-mutation-protocol/text-codec-node";
import {
  readFileMutationDownload,
  resolveFileMutationRoot,
} from "../../src/tools/execution/file-mutation-service.js";
import { fileContentSha256 } from "../../src/tools/execution/file-mutation-state.js";
import { searchFilesWithRipgrep } from "../../src/tools/execution/file-search.js";
import { syncBuiltinESMExports } from "node:module";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-encoding-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const context = buildAgentContext(root);
  const tools = new Map(createFileTool({ agentContext: context }).map((tool) => [tool.name, tool]));
  return {
    root,
    mutationRoot: resolveFileMutationRoot(context.bindings.runtime.systemRuntime.sessionDir),
    invoke: async (name, args) =>
      parseToolResult(await tools.get(name).invoke({ riskLevel: "low", ...args })),
  };
}

for (const encoding of FILE_TEXT_ENCODINGS) {
  for (const bom of [false, true]) {
    test(`${encoding} bom=${bom}: read, move, edit, download and write preserve encoding`, async (t) => {
      const { root, invoke, mutationRoot } = await fixture(t);
      const content = `${bom ? "\uFEFF" : ""}中文😀\0\u0007\r\nold\ntail`;
      const bytes = encodeFileText(content, encoding);
      await fs.writeFile(path.join(root, "a.txt"), bytes);
      const inputEncoding = bom && encoding !== "gb18030" ? "auto" : encoding;
      const read = await invoke("read_file", { filePath: "a.txt", encoding: inputEncoding });
      assert.equal(read.textFormat.encoding, encoding);
      assert.equal(read.textFormat.bom, bom);
      assert.equal(read.textFormat.finalNewline, false);
      const moved = await invoke("patch_file", {
        encoding: inputEncoding,
        patch: "*** Begin Patch\n*** Update File: a.txt\n*** Move to: b.txt\n*** End Patch",
        baseVersions: [
          { filePath: "a.txt", sha256: read.baseSha256 },
          { filePath: "b.txt", sha256: null },
        ],
      });
      assert.equal(moved.ok, true);
      assert.deepEqual(await fs.readFile(path.join(root, "b.txt")), bytes);
      const edited = await invoke("patch_file", {
        encoding: inputEncoding,
        patch: "*** Begin Patch\n*** Update File: b.txt\n@@ L2\n-old\n+新行\n*** End Patch",
        baseVersions: [{ filePath: "b.txt", sha256: fileContentSha256(bytes) }],
      });
      const expected = encodeFileText(content.replace("old\n", "新行\r\n"), encoding);
      assert.deepEqual(await fs.readFile(path.join(root, "b.txt")), expected);
      const mutation = edited.mutations[0];
      const downloaded = await readFileMutationDownload({
        mutationRoot,
        mutationId: mutation.id,
        revision: mutation.aggregate.revision,
        afterSha256: mutation.after.sha256,
      });
      assert.deepEqual(downloaded.content, expected);
      await invoke("write_file", { filePath: "b.txt", content, encoding: inputEncoding });
      assert.deepEqual(await fs.readFile(path.join(root, "b.txt")), bytes);
      const replacement = await invoke("write_file", {
        filePath: "b.txt",
        content: "replacement",
        encoding: inputEncoding,
      });
      const replaced = replacement.mutations[0];
      assert.equal(replaced.before.isText, true);
      assert.equal(replaced.before.textFormat.encoding, encoding);
      assert.equal(replaced.after.textFormat.encoding, encoding);
      const replacementBytes = encodeFileText("replacement", encoding);
      assert.deepEqual(await fs.readFile(path.join(root, "b.txt")), replacementBytes);
      const replacementDownload = await readFileMutationDownload({
        mutationRoot,
        mutationId: replaced.id,
        revision: 1,
        afterSha256: replaced.after.sha256,
      });
      assert.deepEqual(replacementDownload.content, replacementBytes);
    });
  }
  test(`search validates ${encoding} and returns the same Unicode text as read`, async (t) => {
    const { root } = await fixture(t);
    await fs.writeFile(
      path.join(root, "a.txt"),
      encodeFileText("before\0\n中文😀\r\nsecond\0\n", encoding),
    );
    const result = await searchFilesWithRipgrep({
      rootPath: root,
      target: "a.txt",
      query: "中文😀",
      isRegex: false,
      caseSensitive: true,
      contextLines: 1,
      maxResults: 5,
      encoding,
      abortSignal: new AbortController().signal,
    });
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].text, "中文😀");
    assert.equal(result.matches[0].encoding, encoding);
    assert.deepEqual(result.matches[0].before, [{ line: 1, text: "before\0" }]);
    assert.deepEqual(result.matches[0].after, [{ line: 3, text: "second\0" }]);
  });
}

test("write rejects invalid source encodings without changing bytes or publishing records", async (t) => {
  const { root, invoke, mutationRoot } = await fixture(t);
  const filePath = path.join(root, "a.txt");
  const cases = [
    { bytes: Buffer.from([0x61, 0xff, 0x0a]), encoding: "auto", error: /UTF-8/ },
    { bytes: Buffer.from([0x61, 0xff, 0x0a]), encoding: "utf-8", error: /UTF-8/ },
    { bytes: encodeFileText("中文", "gb18030"), encoding: "auto", error: /UTF-8/ },
    { bytes: encodeFileText("\uFEFF中文", "utf-16le"), encoding: "utf-8", error: /BOM conflicts/ },
    {
      bytes: encodeFileText("\uFEFF中文", "utf-16be"),
      encoding: "utf-16le",
      error: /BOM conflicts/,
    },
    { bytes: Buffer.from([0x61]), encoding: "utf-16le", error: /utf-16le/ },
  ];
  for (const { bytes, encoding, error } of cases) {
    await fs.writeFile(filePath, bytes);
    await assert.rejects(
      invoke("write_file", { filePath: "a.txt", content: "new", encoding }),
      error,
    );
    assert.deepEqual(await fs.readFile(filePath), bytes);
    assert.deepEqual(await fs.readdir(root), ["a.txt"]);
    await assert.rejects(fs.access(mutationRoot), { code: "ENOENT" });
  }
  await invoke("write_file", { filePath: "new.txt", content: "中文" });
  assert.deepEqual(await fs.readFile(path.join(root, "new.txt")), Buffer.from("中文"));
});

test("search rejects invalid UTF-8 even when ripgrep transcoding replaces it", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, "a.txt"), Buffer.from([0x61, 0xff, 0x0a]));
  await assert.rejects(
    searchFilesWithRipgrep({
      rootPath: root,
      target: "a.txt",
      query: "a",
      isRegex: false,
      caseSensitive: true,
      contextLines: 0,
      maxResults: 5,
      encoding: "utf-8",
      abortSignal: new AbortController().signal,
    }),
    /UTF-8/,
  );
});

test("search rejects context changed before validation", async (t) => {
  const { root } = await fixture(t);
  const filePath = path.join(root, "a.txt");
  await fs.writeFile(filePath, "match\ncontext\n");
  const read = fs.readFile;
  let validatedReads = 0;
  t.mock.method(fs, "readFile", async (file, ...args) => {
    if (file === filePath) {
      validatedReads += 1;
      return Buffer.from("match\nchanged\n");
    }
    return read(file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await assert.rejects(
    searchFilesWithRipgrep({
      rootPath: root,
      target: "a.txt",
      query: "match",
      isRegex: false,
      caseSensitive: true,
      contextLines: 1,
      maxResults: 5,
      abortSignal: new AbortController().signal,
    }),
    /search result differs from file content/,
  );
  assert.equal(validatedReads, 1);
});
