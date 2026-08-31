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

function descriptor() {
  return {
    assetId: "asset.one",
    name: "asset.glb",
    format: "glb",
    size: 12,
    animations: [{ name: "Idle", duration: 1, tracks: 1 }],
    nodes: ["Root"],
    bounds: { min: [0, 0, 0], max: [1, 1, 1], height: 1 },
    normalization: { targetHeight: 1, scale: 1, floorOffset: 0 },
    importedAt: "2026-08-31T00:00:00.000Z",
    resource: {
      version: "a".repeat(64),
      mimeType: "model/gltf-binary",
      size: 12,
      url: `/api/internal/character/assets/asset.one/${"a".repeat(64)}`,
    },
  };
}

function response() {
  return {
    statusCode: 0,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.value = value;
    },
  };
}

function workspaceAssets(overrides = {}) {
  return {
    async write() {},
    async read() {},
    async listMetadata() {
      return {};
    },
    async writeMetadata() {},
    async delete() {},
    ...overrides,
  };
}

test("character asset write validates GLB and returns its canonical resource", async () => {
  let written;
  const handlers = createCharacterAssetRouteHandlers({
    workspaceAssets: workspaceAssets({
      async write(input) {
        written = input;
        input.validate({ prefix: glbBuffer(), size: 12 });
        return { assetId: input.assetId, version: "a".repeat(64), size: 12 };
      },
    }),
  });
  const result = response();

  await handlers["character.asset.write"](request(glbBuffer()), result);

  assert.equal(written.userId, "admin");
  assert.equal(result.statusCode, 201);
  assert.deepEqual(result.value.asset.resource, {
    version: "a".repeat(64),
    mimeType: "model/gltf-binary",
    size: 12,
    url: `/api/internal/character/assets/asset.one/${"a".repeat(64)}`,
  });
});

test("character asset write rejects a non-GLB payload", async () => {
  const handlers = createCharacterAssetRouteHandlers({
    workspaceAssets: workspaceAssets({
      async write(input) {
        input.validate({ prefix: Buffer.from("not a glb file"), size: 14 });
      },
    }),
  });
  await assert.rejects(
    () => handlers["character.asset.write"](request(Buffer.from("not a glb file")), {}),
    /binary GLB/,
  );
});

test("character asset descriptor commit, list, and delete use the user catalog", async () => {
  const asset = descriptor();
  const calls = [];
  const handlers = createCharacterAssetRouteHandlers({
    workspaceAssets: workspaceAssets({
      async read(input) {
        calls.push(["read", input]);
        return { size: 12, stream: { destroy() {} } };
      },
      async writeMetadata(input) {
        calls.push(["writeMetadata", input]);
        return input.metadata;
      },
      async listMetadata(input) {
        calls.push(["listMetadata", input]);
        return { "asset.one": asset };
      },
      async delete(input) {
        calls.push(["delete", input]);
        return { assetId: input.assetId, deleted: true };
      },
    }),
  });
  const commitRequest = request(glbBuffer());
  commitRequest.body = asset;
  const committed = response();
  await handlers["character.asset.commit"](commitRequest, committed);
  assert.equal(committed.statusCode, 201);
  assert.deepEqual(committed.value.asset, asset);

  const listed = response();
  await handlers["character.asset.list"](request(glbBuffer()), listed);
  assert.deepEqual(listed.value.assets, [asset]);

  const removed = response();
  await handlers["character.asset.delete"](request(glbBuffer()), removed);
  assert.deepEqual(removed.value, { ok: true, assetId: "asset.one", deleted: true });
  assert.deepEqual(
    calls.map(([name]) => name),
    ["read", "writeMetadata", "listMetadata", "delete"],
  );
  assert.ok(calls.every(([, input]) => input.userId === "admin"));
});

test("character asset descriptor rejects mismatched identity", async () => {
  const handlers = createCharacterAssetRouteHandlers({ workspaceAssets: workspaceAssets() });
  const req = request(glbBuffer());
  req.body = { ...descriptor(), assetId: "asset.two" };
  await assert.rejects(
    () => handlers["character.asset.commit"](req, response()),
    /does not match its resource identity/,
  );
});
