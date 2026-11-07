/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MIME_TO_EXTENSION } from "@noobot/attachment-protocol/mime";
import { isPlainObject, text } from "@noobot/shared/value";

export function normalizeGeneratedMediaArtifact(value) {
  if (!isPlainObject(value)) throw new TypeError("generated media artifact must be an object");
  const fields = new Set(["fileName", "mimeType", "contentBase64", "url"]);
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new TypeError(`unsupported generated media field: ${key}`);
  }
  const fileName = text(value.fileName);
  const mimeType = text(value.mimeType);
  if (!fileName || !/^(image|video)\//.test(mimeType) || !MIME_TO_EXTENSION[mimeType])
    throw new TypeError("generated media requires a filename and supported image/video MIME type");
  const contentBase64 = text(value.contentBase64);
  const url = text(value.url);
  if (
    contentBase64 &&
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)
  )
    throw new TypeError("generated media contentBase64 must use valid padded base64");
  if (Boolean(contentBase64) === Boolean(url))
    throw new TypeError("generated media requires exactly one of contentBase64 or url");
  if (url && !["http:", "https:"].includes(new URL(url).protocol))
    throw new TypeError("generated media URL must use HTTP or HTTPS");
  return Object.freeze({ fileName, mimeType, contentBase64, url });
}

export function createGeneratedMediaArtifact({
  outputType,
  contentBase64 = "",
  url = "",
  mimeType,
  index = 0,
}) {
  const extension = MIME_TO_EXTENSION[mimeType];
  if (!extension || !mimeType.startsWith(`${outputType}/`))
    throw new TypeError(`invalid generated ${outputType} media type: ${mimeType}`);
  return normalizeGeneratedMediaArtifact({
    fileName: `generated_${outputType}_${index + 1}${extension}`,
    mimeType,
    contentBase64,
    url,
  });
}
