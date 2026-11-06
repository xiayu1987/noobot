/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, expect, it, vi } from "vitest";
import {
  createFilePreviewState,
  readFilePreviewBlob,
  readFilePreviewText,
} from "../../../src/shared/composables/useFilePreview.js";
import { describeFilePreview } from "@noobot/attachment-protocol/preview";

const descriptor = (name) => ({ name, ...describeFilePreview({ name }) });
const source = (name, fetchResponse, resourceUrl) => async () => ({
  descriptor: descriptor(name),
  readText: async (signal) => readFilePreviewText(await fetchResponse(signal), descriptor(name)),
  editable: false,
  authorizeResource: async () => ({ url: resourceUrl, expiresAt: Date.now() + 3600000 }),
});
const response = (content) => ({ ok: true, blob: async () => new NodeBlob([content]) });
afterEach(() => vi.restoreAllMocks());

it("aborts the previous request and never publishes its late result", async () => {
  const preview = createFilePreviewState();
  let finish;
  let signal;
  const old = preview.load(
    source("old.txt", (requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }),
  );
  await Promise.resolve();
  await preview.load(source("new.txt", async () => response("new")));
  expect(signal.aborted).toBe(true);
  finish(response("old"));
  await old;
  expect(preview.state.textContent.value).toBe("new");
  expect(preview.state.name.value).toBe("new.txt");
  expect(preview.state.loading.value).toBe(false);
});

it("hands media to the browser without fetching or buffering it and clears the URL on close", async () => {
  const fetchResponse = vi.fn();
  const preview = createFilePreviewState();
  await preview.load(source("clip.mp4", fetchResponse, "/authorized/video"));
  expect(preview.state.url.value).toBe("/authorized/video");
  await preview.load(source("image.png", fetchResponse, "/authorized/image"));
  expect(preview.state.url.value).toBe("/authorized/image");
  expect(fetchResponse).not.toHaveBeenCalled();
  preview.reset();
  expect(preview.state.url.value).toBe("");
  expect(preview.state.visible.value).toBe(false);
});

it("rejects malformed UTF-8 without replacing source bytes", async () => {
  const preview = createFilePreviewState();
  await preview.load(source("bad.txt", async () => response(new Uint8Array([255]))));
  expect(preview.state.error.value).not.toBe("");
  expect(preview.state.textContent.value).toBe("");
});

it("cancels an oversized response even with no content length", async () => {
  const cancel = vi.fn();
  const releaseLock = vi.fn();
  const read = vi.fn().mockResolvedValue({ done: false, value: new Uint8Array(5) });
  const onBytes = vi.fn();
  await expect(
    readFilePreviewBlob({ body: { getReader: () => ({ read, cancel, releaseLock }) } }, 4, onBytes),
  ).rejects.toThrow("FILE_PREVIEW_TOO_LARGE");
  expect(read).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledOnce();
  expect(releaseLock).toHaveBeenCalledOnce();
  expect(onBytes).toHaveBeenCalledWith(5);
});

it("checks announced and actual media sizes against the same descriptor", async () => {
  const cancel = vi.fn();
  await expect(
    readFilePreviewBlob(
      { headers: new Headers({ "content-length": "5" }), body: { cancel } },
      4,
      vi.fn(),
    ),
  ).rejects.toThrow("FILE_PREVIEW_TOO_LARGE");
  expect(cancel).toHaveBeenCalledOnce();
  await expect(readFilePreviewBlob(response("12345"), 4, vi.fn())).rejects.toThrow(
    "FILE_PREVIEW_TOO_LARGE",
  );
});

it("renews resource access before expiry and cancels renewal when the document closes", async () => {
  vi.useFakeTimers();
  const preview = createFilePreviewState();
  const authorizeResource = vi.fn(async () => ({
    url: `/ticket/${Date.now()}`,
    expiresAt: Date.now() + 1000,
  }));
  try {
    await preview.load(async () => ({ descriptor: descriptor("clip.mp4"), authorizeResource }));
    const first = preview.state.url.value;
    await vi.advanceTimersByTimeAsync(500);
    expect(authorizeResource).toHaveBeenCalledTimes(2);
    expect(preview.state.url.value).not.toBe(first);
    authorizeResource.mockRejectedValueOnce(new Error("session expired"));
    await vi.advanceTimersByTimeAsync(500);
    expect(preview.state.error.value).toBe("session expired");
    preview.reset();
    await vi.advanceTimersByTimeAsync(2000);
    expect(authorizeResource).toHaveBeenCalledTimes(3);
  } finally {
    preview.reset();
    vi.useRealTimers();
  }
});

it("preserves resource MIME after bounded streaming reads", async () => {
  const onBytes = vi.fn();
  const blob = await readFilePreviewBlob(
    new Response("image", { headers: { "content-type": "image/png" } }),
    100,
    onBytes,
  );
  expect(blob.type).toBe("image/png");
  expect(blob.size).toBe(5);
  expect(onBytes).toHaveBeenCalledWith(5);
});

it("releases local resource URLs on replacement and ignores late Blob reads", async () => {
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const preview = createFilePreviewState();
  const local = (readBlob) => async () => ({ descriptor: descriptor("icon.svg"), readBlob });
  await preview.load(local(async () => new Blob(["svg"])));
  expect(preview.state.url.value).toBe("blob:local");
  const pending = Promise.withResolvers();
  const stale = preview.load(local(() => pending.promise));
  await Promise.resolve();
  expect(revoke).toHaveBeenCalledWith("blob:local");
  preview.reset();
  pending.resolve(new Blob(["late"]));
  await stale;
  expect(create).toHaveBeenCalledOnce();
  expect(preview.state.url.value).toBe("");
});

it("rejects ambiguous resource sources rather than silently choosing one", async () => {
  const preview = createFilePreviewState();
  await preview.load(async () => ({
    descriptor: descriptor("icon.svg"),
    readBlob: vi.fn(),
    authorizeResource: vi.fn(),
  }));
  expect(preview.state.error.value).toBe("FILE_PREVIEW_RESOURCE_SOURCE_AMBIGUOUS");
});
