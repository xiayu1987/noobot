/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { executionLogProjectionIdentity } from "@noobot/session-protocol";
import { appendJsonLine } from "../src/transports/jsonl.js";

test("ordinary output waits for a foreign projection intent, including with a warm destination", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "concurrent-output-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "interaction.jsonl");
  const options = {
    projection: {
      file: path.join(root, "receipt.json"),
      sourceId: executionLogProjectionIdentity("d1", 1, 0),
    },
  };
  await appendJsonLine(file, { seed: true });
  const moduleUrl = new URL("../src/transports/jsonl.js", import.meta.url).href;
  const script = path.join(root, "writer.mjs");
  await fs.writeFile(
    script,
    `
    import fs from 'node:fs/promises';
    import { appendJsonLine } from ${JSON.stringify(moduleUrl)};
    const [file, options] = JSON.parse(process.argv[2]);
    const rename = fs.rename.bind(fs);
    const release = new Promise(resolve => process.once('message', resolve));
    fs.rename = async (source, destination) => {
      await rename(source, destination);
      if (destination.endsWith('.projection-pending.json')) {
        process.send('intent');
        await release;
      }
    };
    try {
      await appendJsonLine(file, { projected: true }, options);
      process.send({ ok: true });
    } catch (error) {
      process.send({ error: error.message });
    } finally { process.disconnect(); }
  `,
  );
  const child = fork(script, [JSON.stringify([file, options])], { silent: true });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const finished = once(child, "exit");
  const first = await once(child, "message");
  assert.equal(first[0], "intent", stderr);
  const outcome = once(child, "message");
  let completed = false;
  const ordinary = appendJsonLine(file, { ordinary: true }).finally(() => {
    completed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const completedBeforeRelease = completed;
  child.send("release");
  const [result] = await outcome;
  await ordinary;
  await finished;
  assert.equal(completedBeforeRelease, false, "ordinary append bypassed the foreign publication");
  assert.deepEqual(result, { ok: true }, stderr);
  await appendJsonLine(file, { projected: true }, options);
  assert.deepEqual((await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse), [
    { seed: true },
    { projected: true },
    { ordinary: true },
  ]);
});
