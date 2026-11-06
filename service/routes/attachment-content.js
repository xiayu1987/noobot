/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { pipeline } from "node:stream/promises";
import { buildContentDisposition } from "./content-disposition.js";

function readByteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
    return null;
  return { start, end };
}

export async function sendAttachmentContent(req, res, attachment) {
  try {
    res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", buildContentDisposition("inline", attachment.name));
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Accept-Ranges", "bytes");
    const rangeHeader = req.headers["if-range"] ? undefined : req.headers.range;
    const range = rangeHeader ? readByteRange(rangeHeader, attachment.size) : undefined;
    if (range === null) {
      res.setHeader("Content-Range", `bytes */${attachment.size}`);
      res.status(416).end();
      return;
    }
    if (range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${attachment.size}`);
    }
    res.setHeader("Content-Length", range ? range.end - range.start + 1 : attachment.size);
    if (req.method === "HEAD" || attachment.size === 0) {
      res.end();
      return;
    }
    await pipeline(attachment.createReadStream(range), res);
  } finally {
    await attachment.close();
  }
}
