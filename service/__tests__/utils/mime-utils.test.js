/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  extendMimeMap,
  getMimeExtensionMap,
  getExtensionFromMime,
  parseDataUrl,
  sanitizeGeneratedArtifactName,
} from "../../system-core/utils/mime-utils.js";

test("getExtensionFromMime exact match", () => {
  assert.equal(getExtensionFromMime("image/png"), ".png");
  assert.equal(getExtensionFromMime("video/mp4"), ".mp4");
  assert.equal(getExtensionFromMime("audio/mpeg"), ".mp3");
  assert.equal(getExtensionFromMime("application/pdf"), ".pdf");
});

test("getExtensionFromMime prefix fallback", () => {
  assert.equal(getExtensionFromMime("image/svg+xml"), ".png");
  assert.equal(getExtensionFromMime("video/x-msvideo"), ".mp4");
  assert.equal(getExtensionFromMime("audio/x-flac"), ".mp3");
});

test("getExtensionFromMime unknown returns empty", () => {
  assert.equal(getExtensionFromMime("application/unknown"), "");
  assert.equal(getExtensionFromMime(""), "");
  assert.equal(getExtensionFromMime(undefined), "");
});

test("getExtensionFromMime case insensitive", () => {
  assert.equal(getExtensionFromMime("IMAGE/PNG"), ".png");
  assert.equal(getExtensionFromMime("  Video/Mp4  "), ".mp4");
});

test("extendMimeMap and getMimeExtensionMap", () => {
  extendMimeMap({ "application/zip": ".zip", "text/csv": ".csv" });
  const map = getMimeExtensionMap();
  assert.equal(map["application/zip"], ".zip");
  assert.equal(map["text/csv"], ".csv");
  // existing entries still present
  assert.equal(map["image/png"], ".png");
});

test("parseDataUrl valid", () => {
  const result = parseDataUrl("data:image/png;base64,iVBORw0KGgo=");
  assert.deepEqual(result, {
    mimeType: "image/png",
    contentBase64: "iVBORw0KGgo=",
  });
});

test("parseDataUrl invalid", () => {
  assert.equal(parseDataUrl(""), null);
  assert.equal(parseDataUrl("not-a-data-url"), null);
  assert.equal(parseDataUrl("data:image/png"), null);
});

test("sanitizeGeneratedArtifactName adds extension", () => {
  assert.equal(
    sanitizeGeneratedArtifactName("photo", "image/jpeg", 1),
    "photo.jpg",
  );
  assert.equal(
    sanitizeGeneratedArtifactName("", "image/png", 3),
    "generated_media_3.png",
  );
});

test("sanitizeGeneratedArtifactName skips duplicate extension", () => {
  assert.equal(
    sanitizeGeneratedArtifactName("report.pdf", "application/pdf", 1),
    "report.pdf",
  );
});

test("sanitizeGeneratedArtifactName strips unsafe chars", () => {
  assert.equal(
    sanitizeGeneratedArtifactName("my/file:name?.png", "image/png", 1),
    "my_file_name_.png",
  );
});
