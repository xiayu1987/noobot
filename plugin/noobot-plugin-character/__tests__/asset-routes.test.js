/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createCharacterAssetRouteHandlers } from "../src/service/asset-routes.js";

function glbBuffer() {
  const value = Buffer.alloc(12);
  value.write("glTF", 0, "ascii");
  value.writeUInt32LE(2, 4);
  value.writeUInt32LE(value.length, 8);
  return value;
}

function request(buffer, headers = {}) {
  const req = Readable.from(buffer);
  req.auth = { userId: "admin" };
  req.params = { assetId: "asset.one", version: "a".repeat(64) };
  req.headers = {
    "content-type": "model/gltf-binary",
    "content-length": String(buffer.length),
    ...headers,
  };
  return req;
}

test("character asset write validates GLB and returns its canonical resource", async () => {
  let written;
  const handlers = createCharacterAssetRouteHandlers({
    workspaceAssets: {
      async write(input) {
        written = input;
        input.validate({ prefix: glbBuffer(), size: 12 });
        return { assetId: input.assetId, version: "a".repeat(64), size: 12 };
      },
      async read() {},
    },
  });
  const response = {
    statusCode: 0,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.value = value;
    },
  };

  await handlers["character.asset.write"](request(glbBuffer()), response);

  assert.equal(written.userId, "admin");
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.value.asset.resource, {
    version: "a".repeat(64),
    mimeType: "model/gltf-binary",
    size: 12,
    url: `/api/internal/character/assets/asset.one/${"a".repeat(64)}`,
  });
});

test("character asset write rejects a non-GLB payload", async () => {
  const handlers = createCharacterAssetRouteHandlers({
    workspaceAssets: {
      async write(input) {
        input.validate({ prefix: Buffer.from("not a glb file"), size: 14 });
      },
      async read() {},
    },
  });
  await assert.rejects(
    () => handlers["character.asset.write"](request(Buffer.from("not a glb file")), {}),
    /binary GLB/,
  );
});
