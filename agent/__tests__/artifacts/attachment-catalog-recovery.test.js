/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AttachmentService } from "../../src/artifacts/service/attachment-service.js";
import { attachScopeRoot } from "../../src/artifacts/service/attachment-storage-layout.js";

const moduleUrl = (file) => new URL(file, import.meta.url).href;
const writerSource = `
  import { writeSync } from "node:fs";
  import { open } from "node:fs/promises";
  import { AttachmentService } from ${JSON.stringify(moduleUrl("../../src/artifacts/service/attachment-service.js"))};
  import { setFsAdapter } from ${JSON.stringify(moduleUrl("../../src/shared/storage/fs-adapter.js"))};
  const [workspaceRoot, raw] = process.argv.slice(1);
  setFsAdapter({ open: async (path, ...options) => {
    const handle = await open(path, ...options);
    if (!String(path).endsWith(".txt")) return handle;
    return {
      writeFile: (...args) => handle.writeFile(...args),
      sync: async () => {
        await handle.sync();
        writeSync(1, "durable body");
        process.kill(process.pid, "SIGKILL");
      },
      close: () => handle.close(),
    };
  } });
  await new AttachmentService({ workspaceRoot }).ingestGeneratedArtifacts(JSON.parse(raw));
`;

test("a process interruption leaves unpublished bodies invisible and the next write reclaims them", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "attachment-catalog-process-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const scope = { sessionId: "s1", attachmentSource: "model" };
  const request = {
    userId: "u1",
    ...scope,
    artifacts: [{ name: "result.txt", contentBase64: "YQ==" }],
  };
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      moduleUrl("../../../shared/testing/runtime-params.js"),
      "--input-type=module",
      "--eval",
      writerSource,
      workspaceRoot,
      JSON.stringify(request),
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.signal, "SIGKILL", child.stderr);
  assert.equal(child.stdout, "durable body");
  const directory = attachScopeRoot(join(workspaceRoot, "u1"), scope);
  const before = (await readdir(directory)).filter((name) => name.endsWith(".txt"));
  assert.equal(before.length, 1);
  const service = new AttachmentService({ workspaceRoot });
  assert.deepEqual(await service.readAttachmentMetas({ userId: "u1", ...scope }), []);
  const [record] = await service.ingestGeneratedArtifacts(request);
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.endsWith(".txt")),
    [`${record.attachmentId}.txt`],
  );
  assert.notEqual(`${record.attachmentId}.txt`, before[0]);
  assert.equal(
    (await service.readAttachmentMetas({ userId: "u1", ...scope }))[0].attachmentId,
    record.attachmentId,
  );
});
