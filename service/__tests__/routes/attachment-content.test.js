/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import express from "express";
import { sendAttachmentContent } from "../../routes/attachment-content.js";
import { withTestServer } from "./session-routes.helpers.js";
import { createAuthService } from "../../services/auth-service.js";

test("browser media requests require existing API authorization and stream byte ranges", async () => {
  const bytes = Buffer.from("0123456789");
  const auth = createAuthService({ translateText: (key) => key });
  const key = auth.issueApiKey({ userId: "u1", role: "user" });
  let closed = 0;
  let streamed = 0;
  const app = express();
  app.get("/media", auth.requireApiKey, async (req, res) => {
    await sendAttachmentContent(req, res, {
      name: "clip.mp4",
      mimeType: "video/mp4",
      size: bytes.length,
      createReadStream: (range) => {
        streamed += 1;
        return Readable.from([range ? bytes.subarray(range.start, range.end + 1) : bytes]);
      },
      close: async () => {
        closed += 1;
      },
    });
  });
  await withTestServer(app, async (base) => {
    assert.equal((await fetch(`${base}/media`)).status, 401);
    for (const [range, status, content, contentRange] of [
      [undefined, 200, "0123456789", null],
      ["bytes=2-4", 206, "234", "bytes 2-4/10"],
      ["bytes=7-", 206, "789", "bytes 7-9/10"],
      ["bytes=-3", 206, "789", "bytes 7-9/10"],
      ["bytes=8-99", 206, "89", "bytes 8-9/10"],
      ["bytes=20-", 416, "", "bytes */10"],
      ["bytes=3-1", 416, "", "bytes */10"],
      ["bytes=-0", 416, "", "bytes */10"],
      ["bytes=0-1,4-5", 416, "", "bytes */10"],
    ]) {
      const response = await fetch(`${base}/media?apikey=${key}`, {
        headers: range ? { Range: range } : {},
      });
      assert.equal(response.status, status, range);
      assert.equal(response.headers.get("accept-ranges"), "bytes");
      assert.equal(response.headers.get("content-range"), contentRange);
      assert.equal(await response.text(), content);
    }
    const head = await fetch(`${base}/media?apikey=${key}`, {
      method: "HEAD",
      headers: { Range: "bytes=2-4" },
    });
    assert.equal(head.status, 206);
    assert.equal(head.headers.get("content-length"), "3");
    assert.equal(await head.text(), "");
    const ifRange = await fetch(`${base}/media?apikey=${key}`, {
      headers: { Range: "bytes=2-4", "If-Range": "unmatched" },
    });
    assert.equal(ifRange.status, 200);
    assert.equal(await ifRange.text(), "0123456789");
  });
  assert.equal(closed, 11);
  assert.equal(streamed, 6);
});
