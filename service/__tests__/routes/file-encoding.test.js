/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FILE_TEXT_ENCODINGS } from "@noobot/file-mutation-protocol";
import { encodeFileText } from "@noobot/file-mutation-protocol/text-codec-node";
import { registerFileCrudRoutes } from "../../routes/file-crud-routes.js";

async function fixture(t, trackMutations) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-service-encoding-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = express();
  app.use(express.json());
  registerFileCrudRoutes(app, {
    routePrefix: "/files",
    resolveRootPath: () => root,
    translateText: (key) => key,
    trackMutations,
    resolveMutationRoot: () => path.join(root, "records"),
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const url = `http://127.0.0.1:${server.address().port}/files/file`;
  return { root, url };
}

for (const trackMutations of [false, true]) {
  test(`service rejects invalid source encodings without writes (tracked=${trackMutations})`, async (t) => {
    const { root, url } = await fixture(t, trackMutations);
    const filePath = path.join(root, "a.txt");
    const cases = [
      { bytes: Buffer.from([0x61, 0xff, 0x0a]), encoding: "auto" },
      { bytes: Buffer.from([0x61, 0xff, 0x0a]), encoding: "utf-8" },
      { bytes: encodeFileText("中文", "gb18030"), encoding: "auto" },
      { bytes: encodeFileText("\uFEFF中文", "utf-16le"), encoding: "utf-8" },
      { bytes: encodeFileText("\uFEFF中文", "utf-16be"), encoding: "utf-16le" },
      { bytes: Buffer.from([0x61]), encoding: "utf-16le" },
    ];
    for (const { bytes, encoding } of cases) {
      await fs.writeFile(filePath, bytes);
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "a.txt", content: "new", encoding }),
      });
      assert.equal(response.status, 400, JSON.stringify(await response.json()));
      assert.deepEqual(await fs.readFile(filePath), bytes);
      assert.deepEqual(await fs.readdir(root), ["a.txt"]);
    }
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new.txt", content: "中文" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await fs.readFile(path.join(root, "new.txt")), Buffer.from("中文"));
  });

  test(`service encoding read/save contract and Unicode rejection (tracked=${trackMutations})`, async (t) => {
    const { root, url } = await fixture(t, trackMutations);
    for (const encoding of FILE_TEXT_ENCODINGS) {
      const content = `${encoding.startsWith("utf-") ? "\uFEFF" : ""}中文😀\0\u0007\r\nlast`;
      const bytes = encodeFileText(content, encoding);
      await fs.writeFile(path.join(root, "a.txt"), bytes);
      const requestedEncoding = encoding === "gb18030" ? encoding : "auto";
      const response = await fetch(`${url}?path=a.txt&encoding=${requestedEncoding}`);
      assert.equal(response.status, 200);
      const preview = await response.json();
      assert.equal(preview.isText, true);
      assert.equal(preview.content, content);
      assert.equal(preview.textFormat.encoding, encoding);
      const save = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "a.txt",
          content: preview.content,
          ...(encoding === "gb18030" ? { encoding } : {}),
        }),
      });
      assert.equal(save.status, 200, JSON.stringify(await save.json()));
      assert.deepEqual(await fs.readFile(path.join(root, "a.txt")), bytes);
    }
    for (const content of ["\ud800", "\udfff"]) {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "new.txt", content }),
      });
      assert.equal(response.status, 400);
      await assert.rejects(fs.access(path.join(root, "new.txt")), { code: "ENOENT" });
    }
    const invalid = Buffer.from([0x61, 0xff, 0x0a]);
    await fs.writeFile(path.join(root, "invalid.txt"), invalid);
    const response = await fetch(`${url}?path=invalid.txt`);
    const invalidPreview = await response.json();
    assert.equal(invalidPreview.isText, false);
    assert.match(invalidPreview.textError, /UTF-8/);
  });
}
