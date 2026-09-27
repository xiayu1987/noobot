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
  buildAgentContext,
  parseToolResult,
  createFileTool,
} from "./helpers/file-script-length-guards-helper.js";
import { createPatchFileTool } from "../../src/tools/execution/file-patch-tool.js";
import { createWorkspaceIoExecutor } from "../../src/tools/core/workspace-io-executor.js";
import { resolveToolExecutionPolicy } from "@noobot/execution-isolation-protocol";
import {
  readFileMutation,
  resolveFileMutationRoot,
} from "../../src/tools/execution/file-mutation-service.js";

async function fixture(t, overrides = () => ({})) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-concurrency-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const context = buildAgentContext(root);
  const io = createWorkspaceIoExecutor({
    executionPolicy: resolveToolExecutionPolicy({ toolName: "patch_file" }),
  });
  const workspaceIo = { ...io, ...overrides(root, io) };
  const tool = createPatchFileTool({
    agentContext: context,
    runtime: context.bindings.runtime,
    workspaceIo,
    mutationScopeId: "turn-test",
  });
  const invoke = (body) =>
    tool
      .invoke({
        riskLevel: "low",
        format: "apply_patch",
        patch: `*** Begin Patch\n${body}\n*** End Patch`,
      })
      .then(parseToolResult);
  return { root, context, invoke };
}

const update = (file, before, after) => `*** Update File: ${file}\n@@\n-${before}\n+${after}`;

test("patch continues after script and write_file changes, recording the gaps separately", async (t) => {
  const { root, context, invoke } = await fixture(t, () => ({}));
  const file = path.join(root, "a.txt");
  await fs.writeFile(file, "base\n");
  const first = await invoke(update("a.txt", "base", "patched"));
  await fs.writeFile(file, "script\n");
  await invoke(update("a.txt", "script", "patched-again"));
  const write = createFileTool({ agentContext: context }).find(
    (tool) => tool.name === "write_file",
  );
  await write.invoke({ filePath: "a.txt", content: "replaced\n", riskLevel: "low" });
  const last = await invoke(update("a.txt", "replaced", "final"));
  assert.equal(first.mutations[0].id, last.mutations[0].id);
  assert.equal(last.mutations[0].aggregate.revision, 3);
  assert.equal(last.mutations[0].aggregate.externalChangeCount, 2);
  const record = await readFileMutation({
    mutationRoot: resolveFileMutationRoot(context.bindings.runtime.systemRuntime.sessionDir),
    mutationId: last.mutations[0].id,
  });
  assert.equal(record.snapshots.before, "base\n");
  assert.equal(record.snapshots.after, "final\n");
  assert.deepEqual(
    record.snapshots.externalChanges.map(({ before, after }) => [before, after]),
    [
      ["patched\n", "script\n"],
      ["patched-again\n", "replaced\n"],
    ],
  );
  assert.equal(record.snapshots.diffs[2].lines[0].text, "replaced");
});

test("a change after patch preparation is rejected and a fresh read recovers", async (t) => {
  let interfere = true;
  const { root, invoke } = await fixture(t, (root, io) => ({
    async readBuffer(target) {
      const buffer = await io.readBuffer(target);
      if (interfere) {
        interfere = false;
        await fs.writeFile(target, "external\n");
      }
      return buffer;
    },
  }));
  const file = path.join(root, "a.txt");
  await fs.writeFile(file, "base\n");
  await assert.rejects(invoke(update("a.txt", "base", "stale")), {
    code: "file_mutation_conflict",
  });
  assert.equal(await fs.readFile(file, "utf8"), "external\n");
  assert.equal((await invoke(update("a.txt", "external", "fresh"))).ok, true);
  assert.equal(await fs.readFile(file, "utf8"), "fresh\n");
});

test("add cannot overwrite a file that appeared after preparation", async (t) => {
  const { root, invoke } = await fixture(t, () => ({
    async readBuffer(target) {
      await fs.writeFile(target, "external\n");
      throw Object.assign(new Error("not found at read time"), { code: "ENOENT" });
    },
  }));
  await assert.rejects(invoke("*** Add File: a.txt\n+new"), { code: "file_mutation_conflict" });
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "external\n");
});

test("delete checks the version read during preparation", async (t) => {
  const { root, invoke } = await fixture(t, (root, io) => ({
    async readBuffer(target) {
      const buffer = await io.readBuffer(target);
      await fs.writeFile(target, "external\n");
      return buffer;
    },
  }));
  await fs.writeFile(path.join(root, "a.txt"), "base\n");
  await assert.rejects(invoke("*** Delete File: a.txt"), { code: "file_mutation_conflict" });
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "external\n");
});

test("move detects a changed source and restores the overwritten destination", async (t) => {
  const { root, invoke } = await fixture(t, (root, io) => ({
    async readBuffer(target) {
      const buffer = await io.readBuffer(target);
      if (target.endsWith("b.txt")) await fs.writeFile(path.join(root, "a.txt"), "external\n");
      return buffer;
    },
  }));
  await fs.writeFile(path.join(root, "a.txt"), "base\n");
  await fs.writeFile(path.join(root, "b.txt"), "destination\n");
  await assert.rejects(invoke("*** Update File: a.txt\n*** Move to: b.txt\n@@\n-base\n+moved"), {
    code: "file_mutation_conflict",
  });
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "external\n");
  assert.equal(await fs.readFile(path.join(root, "b.txt"), "utf8"), "destination\n");
});

test("rollback preserves external changes and still restores other files", async (t) => {
  const { root, invoke } = await fixture(t, (root, io) => ({
    async writeText(target, content) {
      if (target.endsWith("c.txt")) {
        await fs.writeFile(path.join(root, "b.txt"), "external\n");
        throw new Error("injected failure");
      }
      await io.writeText(target, content);
    },
  }));
  for (const name of ["a.txt", "b.txt", "c.txt"])
    await fs.writeFile(path.join(root, name), "base\n");
  await assert.rejects(
    invoke(["a.txt", "b.txt", "c.txt"].map((name) => update(name, "base", "patched")).join("\n")),
    { code: "file_mutation_rollback_conflict" },
  );
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "base\n");
  assert.equal(await fs.readFile(path.join(root, "b.txt"), "utf8"), "external\n");
  assert.equal(await fs.readFile(path.join(root, "c.txt"), "utf8"), "base\n");
});

test("repeated updates to one file use the preceding planned version and roll back in reverse", async (t) => {
  const { root, invoke } = await fixture(t, (root, io) => ({
    async writeText(target, content) {
      if (target.endsWith("b.txt")) throw new Error("injected failure");
      await io.writeText(target, content);
    },
  }));
  await fs.writeFile(path.join(root, "a.txt"), "base\n");
  await fs.writeFile(path.join(root, "b.txt"), "base\n");
  const edits = [update("a.txt", "base", "middle"), update("a.txt", "middle", "final")];
  await assert.rejects(
    invoke([...edits, update("b.txt", "base", "fail")].join("\n")),
    /injected failure/,
  );
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "base\n");
  const result = await invoke(edits.join("\n"));
  assert.equal(result.mutations.at(-1).aggregate.revision, 2);
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "final\n");
});
