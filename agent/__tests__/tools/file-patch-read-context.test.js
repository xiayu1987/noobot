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
  executeToolCall,
} from "./helpers/file-script-length-guards-helper.js";
import {
  capturePatchReadVersions,
  bindPatchReadVersions,
} from "../../src/runtime/tool-execution/patch-read-context.js";
import { filterForModelContext } from "@noobot/context-protocol/policy/message";
import { markContextMessageSummarized } from "@noobot/context-protocol/message/codec";
import { parseApplyPatch, parseUnifiedDiff } from "../../src/tools/execution/file-patch/parse.js";
import { applyPatchHunks } from "../../src/tools/execution/file-patch/apply.js";

const edit = (file) => `*** Update File: ${file}\n@@ L1\n-old\n+new`;
const wrap = (body) => `*** Begin Patch\n${body}\n*** End Patch`;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-reads-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const agentContext = buildAgentContext(root);
  const runtime = agentContext.bindings.runtime;
  const tools = new Map(createFileTool({ agentContext }).map((tool) => [tool.name, tool]));
  const messages = [];
  let sequence = 0;
  async function read(filePath, options = {}) {
    const result = await tools.get("read_file").invoke({ filePath, riskLevel: "low", ...options });
    const id = `read-${++sequence}`;
    messages.push(
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id, name: "read_file", args: { filePath } }],
      },
      { role: "tool", tool_call_id: id, content: result },
    );
    return parseToolResult(result);
  }
  async function patch(body, options = {}, reads = capturePatchReadVersions(messages)) {
    return parseToolResult(
      await tools
        .get("patch_file")
        .invoke(
          { patch: wrap(body), riskLevel: "low", ...options },
          { configurable: { patchReadVersions: reads } },
        ),
    );
  }
  return { root, messages, tools, agentContext, runtime, read, patch };
}

test("implicit baselines cover partial reads, dry run and commit without copying hashes", async (t) => {
  const { root, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "old\ntail\n");
  await read("a", { endLine: 1 });
  assert.equal((await patch(edit("a"), { dryRun: true })).ok, true);
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "old\ntail\n");
  assert.equal((await patch(edit("a"))).ok, true);
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "new\ntail\n");
});

test("out-of-hunk external edits conflict and one stale file prevents all writes", async (t) => {
  const { root, read, patch } = await fixture(t);
  for (const file of ["a", "b"]) {
    await fs.writeFile(path.join(root, file), "old\ntail\n");
    await read(file);
  }
  await fs.writeFile(path.join(root, "b"), "old\nexternal\n");
  for (const dryRun of [true, false]) {
    await assert.rejects(patch(`${edit("a")}\n${edit("b")}`, { dryRun }), {
      code: "file_mutation_conflict",
    });
    assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "old\ntail\n");
    assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), "old\nexternal\n");
  }
  await read("b");
  assert.equal((await patch(`${edit("a")}\n${edit("b")}`)).ok, true);
});

test("request snapshots do not acquire later reads or another branch's reads", async (t) => {
  const { root, messages, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "old\n");
  const beforeRead = capturePatchReadVersions(messages);
  await read("a");
  const beforeChange = capturePatchReadVersions(messages);
  await fs.writeFile(path.join(root, "a"), "old\nexternal\n");
  await read("a");
  await assert.rejects(patch(edit("a"), {}, beforeRead), /read these files again/);
  await assert.rejects(patch(edit("a"), {}, beforeChange), { code: "file_mutation_conflict" });
  await assert.rejects(
    patch(edit("a"), {}, capturePatchReadVersions([])),
    /read these files again/,
  );
  assert.equal((await patch(edit("a"))).ok, true);
});

test("parallel reads with different hashes require a new read despite reused resource IDs", async (t) => {
  const { root, messages, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "old\n");
  const first = await read("a");
  await fs.writeFile(path.join(root, "a"), "old\nexternal\n");
  const second = await read("a");
  assert.equal(first.resources[0].resourceId, second.resources[0].resourceId);
  messages[0].tool_calls.push(...messages[2].tool_calls);
  messages.splice(2, 1);
  await assert.rejects(patch(edit("a")), /read these files again/);
  await read("a");
  assert.equal((await patch(edit("a"))).ok, true);
});

test("only model-visible successful read results supply implicit versions", async (t) => {
  const { root, messages, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "old\n");
  await read("a");
  const hidden = messages.map((message) => markContextMessageSummarized({ ...message }));
  const visible = filterForModelContext(hidden);
  assert.equal(visible.length, 0);
  await assert.rejects(
    patch(edit("a"), {}, capturePatchReadVersions(visible)),
    /read these files again/,
  );
  const userOnly = [{ role: "user", content: messages[1].content }];
  await assert.rejects(
    patch(edit("a"), {}, capturePatchReadVersions(userOnly)),
    /read these files again/,
  );
  const wrongTool = structuredClone(messages);
  wrongTool[0].tool_calls[0].name = "execute_script";
  assert.deepEqual(capturePatchReadVersions(wrongTool), []);
  assert.deepEqual(capturePatchReadVersions([messages[1]]), []);
  assert.throws(() => capturePatchReadVersions([messages[0], ...messages]), /unique tool call IDs/);
  assert.deepEqual(
    capturePatchReadVersions([...messages, ...messages]),
    capturePatchReadVersions(messages),
  );
  const overflowed = structuredClone(messages);
  overflowed[1].content = JSON.stringify({ ...JSON.parse(messages[1].content), overflowed: true });
  assert.deepEqual(capturePatchReadVersions(overflowed), []);
});

test("attachment reads do not supply mutation versions or block later file reads", async (t) => {
  const { root, messages, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "old\n");
  await read("a");
  const attachmentMessages = structuredClone(messages);
  const result = JSON.parse(attachmentMessages[1].content);
  result.path = { view: "attachment", identity: "attachment:test" };
  attachmentMessages[1].content = JSON.stringify(result);
  assert.deepEqual(capturePatchReadVersions(attachmentMessages), []);
  attachmentMessages[0].tool_calls[0].id = "attachment-read";
  attachmentMessages[1].tool_call_id = "attachment-read";
  const reads = capturePatchReadVersions([...attachmentMessages, ...messages]);
  assert.equal((await patch(edit("a"), {}, reads)).ok, true);
  result.path = { view: "unknown", path: "a" };
  attachmentMessages[1].content = JSON.stringify(result);
  assert.throws(() => capturePatchReadVersions(attachmentMessages), {
    code: "locator_invalid_view",
  });
});

test("explicit invalid baselines are not replaced by visible reads", async (t) => {
  const { root, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "old\n");
  await read("a");
  await assert.rejects(
    patch(edit("a"), { baseVersions: [{ filePath: "a", sha256: "0".repeat(64) }] }),
    { code: "file_mutation_conflict" },
  );
  await assert.rejects(patch(edit("a"), { baseVersions: [] }), /baseVersions/);
});

test("add requires absence, move to unread destination requires absence, overwrite requires a read", async (t) => {
  const { root, read, patch } = await fixture(t);
  assert.equal((await patch("*** Add File: a\n+old")).ok, true);
  await read("a");
  await assert.rejects(patch("*** Add File: a\n+other"), { code: "file_mutation_conflict" });
  await fs.writeFile(path.join(root, "b"), "destination\n");
  await assert.rejects(patch("*** Update File: a\n*** Move to: b"), {
    code: "file_mutation_conflict",
  });
  await read("b");
  assert.equal((await patch("*** Update File: a\n*** Move to: b")).ok, true);
  assert.equal(await fs.readFile(path.join(root, "b"), "utf8"), "old\n");
  await read("b");
  assert.equal((await patch("*** Update File: b\n*** Move to: c")).ok, true);
  await read("c");
  assert.equal((await patch("*** Delete File: c")).ok, true);
});

test("deterministic shorthand uses the same version and location checks", async (t) => {
  const { root, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "old\n");
  const result = await read("a");
  const bare = "@@ L1\n-old\n+new";
  await assert.rejects(patch("", { patch: bare }), /missing Update File header/);
  const dry = await patch("", { patch: bare, filePath: "a", dryRun: true });
  assert.equal(dry.adaptations.length, 3);
  assert.equal(
    (await patch("", { patch: bare, baseVersions: [{ filePath: "a", sha256: result.baseSha256 }] }))
      .ok,
    true,
  );
  await read("a");
  const mismatch = await patch("", { patch: bare, filePath: "a" });
  assert.equal(mismatch.ok, false);
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "new\n");
});

test("production executor transports the request-bound versions into patch_file", async (t) => {
  const { root, messages, tools, runtime, agentContext, read } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "old\n");
  await read("a");
  const [call] = bindPatchReadVersions(
    {
      toolCalls: [
        { id: "patch-1", name: "patch_file", args: { patch: wrap(edit("a")), riskLevel: "low" } },
      ],
    },
    capturePatchReadVersions(messages),
  ).toolCalls;
  const result = await executeToolCall({
    call,
    tool: tools.get("patch_file"),
    runtime,
    agentContext,
    executionScope: "main",
    turn: 1,
    errorLogger: null,
  });
  assert.equal(result.success, true, result.toolResultText);
  assert.equal(await fs.readFile(path.join(root, "a"), "utf8"), "new\n");
});

test("shorthand diagnostics retain submitted patch line numbers", async (t) => {
  const { root, read, patch } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "old\n");
  await read("a");
  for (const prefix of ["", "*** Begin Patch\n", "*** Update File: a\n"]) {
    const options = { patch: prefix + "@@\n old\n@@\n-old\n+new" };
    if (!prefix.startsWith("*** Update")) options.filePath = "a";
    await assert.rejects(patch("", options), (error) => {
      assert.equal(error.details.patchLine, prefix ? 2 : 1);
      return true;
    });
  }
  const failure = await patch("", { patch: "@@ L1\n-missing\n+new", filePath: "a" });
  assert.equal(failure.details.patchLine, 1);
});

test("session error classes provide actionable diagnostics without guessing positions", () => {
  assert.throws(
    () =>
      parseUnifiedDiff(
        "--- a\n+++ a\n@@ -1,8 +1,8 @@\n one\n two\n three\n four\n five\n@@ -10 +10 @@\n-old\n+new",
      ),
    (error) => {
      assert.deepEqual(error.details.declared, { old: 8, new: 8 });
      assert.deepEqual(error.details.actual, { old: 5, new: 5 });
      assert.equal(error.details.patchLine, 3);
      assert.equal(error.details.stoppedAtPatchLine, 9);
      return true;
    },
  );
  assert.throws(
    () => parseApplyPatch(wrap("*** Update File: a\n@@\n function target() {\n@@\n }\n+insert")),
    (error) => {
      assert.equal(error.details.hunkContent, " function target() {");
      assert.match(error.message, /@@ L<line>/);
      return true;
    },
  );
  const [parsed] = parseApplyPatch(wrap("*** Update File: a\n@@\n-x\n+y"));
  assert.throws(
    () => applyPatchHunks("x\ngap\nx\n", parsed.hunks),
    (error) => {
      assert.deepEqual(error.details.candidateLines, [1, 3]);
      assert.deepEqual(
        error.details.candidates.map((candidate) => candidate.line),
        [1, 3],
      );
      assert.match(error.details.candidates[0].nearbyContent, /gap/);
      return true;
    },
  );
});
