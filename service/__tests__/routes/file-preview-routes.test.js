/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerFileCrudRoutes } from "../../routes/file-crud-routes.js";
import { describeFilePreview } from "@noobot/attachment-protocol/preview";

test("workspace media responses preserve Range, HEAD, MIME and path boundaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-media-preview-"));
  const app = express();
  registerFileCrudRoutes(app, {
    routePrefix: "/workspace",
    resolveRootPath: () => root,
    translateText: (key) => key,
    buildDirectoryArchiveFile: async () => {
      throw new Error("unexpected directory request");
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await writeFile(path.join(root, "clip.mp4"), "0123456789");
    const url = `http://127.0.0.1:${server.address().port}/workspace/preview?path=clip.mp4`;
    const range = await fetch(url, { headers: { Range: "bytes=2-5" } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-type"), "video/mp4");
    assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
    assert.match(range.headers.get("content-disposition"), /^inline;/u);
    assert.match(range.headers.get("content-security-policy"), /sandbox/u);
    assert.equal(range.headers.get("cache-control"), "private, no-store");
    assert.equal(await range.text(), "2345");
    const download = await fetch(url.replace("/preview?", "/download?"));
    assert.match(download.headers.get("content-disposition"), /^attachment;/u);
    assert.equal(await download.text(), "0123456789");
    const head = await fetch(url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal(head.headers.get("cache-control"), "private, no-store");
    assert.equal(await head.text(), "");
    const full = await fetch(url);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("cache-control"), "private, no-store");
    assert.equal(full.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await full.text(), "0123456789");
    const invalidRange = await fetch(url, { headers: { Range: "bytes=20-" } });
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers.get("cache-control"), "private, no-store");
    assert.equal(invalidRange.headers.get("content-range"), "bytes */10");
    assert.equal((await fetch(url.replace("clip.mp4", "."))).status, 400);
    const traversal = await fetch(url.replace("clip.mp4", "..%2Foutside.mp4"));
    assert.equal(traversal.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace file reads return the shared preview contract and preserve source bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-file-preview-"));
  const limit = describeFilePreview({ name: "large.txt" }).maxBytes;
  const app = express();
  registerFileCrudRoutes(app, {
    routePrefix: "/workspace",
    resolveRootPath: () => root,
    translateText: (key) => key,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const fixtures = [
    ["source.md", Buffer.from("\uFEFF# 原文\r\n"), true, "markdown"],
    ["invalid.txt", Buffer.from([255]), false, "unsupported"],
    ["controls.txt", Buffer.from([0, 1, 2]), true, "text"],
    ["clip.mp4", Buffer.alloc(limit + 1), null, "video"],
    ["large.txt", Buffer.alloc(limit + 1, 65), null, "text"],
    ["empty.txt", Buffer.alloc(0), true, "text"],
  ];
  try {
    for (const [name, bytes, isText, type] of fixtures) {
      await writeFile(path.join(root, name), bytes);
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/workspace/file?path=${name}`,
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.isText, isText, name);
      assert.equal(body.preview.type, type, name);
      assert.equal(body.preview.overLimit, name === "large.txt", name);
      assert.equal(body.size, bytes.length);
      assert.equal(body.content, isText ? bytes.toString("utf8") : "");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
