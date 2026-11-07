/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MIME_TO_EXTENSION } from "@noobot/attachment-protocol/mime";
import { normalizeGeneratedMediaArtifact } from "@noobot/model-protocol";

async function downloadArtifact(artifact, { fetchImpl, signal }) {
  if (typeof fetchImpl !== "function") throw new TypeError("runtime fetch unavailable");
  const response = await fetchImpl(artifact.url, { signal });
  if (!response.ok) throw new Error(`generated media download failed: HTTP ${response.status}`);
  const mediaType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== artifact.mimeType)
    throw new TypeError(
      `generated media MIME mismatch: expected ${artifact.mimeType}, received ${mediaType}`,
    );
  return { mimeType: artifact.mimeType, bytes: Buffer.from(await response.arrayBuffer()) };
}

export async function materializeGenerationAttachments(
  artifacts,
  { modality, fetchImpl, abortSignal },
) {
  const signal = abortSignal;
  const output = [];
  for (const artifact of artifacts) {
    signal.throwIfAborted();
    const source = normalizeGeneratedMediaArtifact(artifact);
    const media = source.contentBase64
      ? { mimeType: source.mimeType, bytes: Buffer.from(source.contentBase64, "base64") }
      : await downloadArtifact(source, { fetchImpl, signal });
    const extension = MIME_TO_EXTENSION[media.mimeType];
    if (!media.mimeType.startsWith(`${modality}/`) || !media.bytes.length)
      throw new TypeError("generated media must contain non-empty bytes of the requested type");
    output.push({
      type: "attachment_bytes",
      name: source.fileName.replace(/\.[^.]+$/, extension),
      mimeType: media.mimeType,
      contentBase64: media.bytes.toString("base64"),
    });
  }
  return output;
}
