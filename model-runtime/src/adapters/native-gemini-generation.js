/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  generationArtifact,
  generationRequest,
  generationResult,
  pollGeneration,
  requireGenerationOptions,
} from "./native-generation-http.js";

async function imageContent(context, url) {
  const response = await context.fetchImpl(url, { signal: context.signal });
  if (!response.ok) throw new Error(`source image download failed: HTTP ${response.status}`);
  const mimeType = response.headers.get("content-type")?.split(";")[0];
  if (!mimeType?.startsWith("image/"))
    throw new TypeError("source image requires an image media type");
  return { mimeType, data: Buffer.from(await response.arrayBuffer()).toString("base64") };
}

function interactionStatus(payload) {
  const status = payload.status;
  return {
    status,
    done: status === "completed",
    pending: status === "in_progress",
    failed: ["failed", "cancelled", "requires_action"].includes(status),
    message: payload.error?.message,
  };
}

function interactionMedia(payload, kind) {
  const content = (payload.steps || [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || []);
  const artifacts = content
    .filter((item) => item.type === kind)
    .map((item, index) =>
      generationArtifact({ kind, data: item.data, url: item.uri, mimeType: item.mime_type, index }),
    );
  const rawText = content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  return generationResult(kind, artifacts, { rawText, taskId: payload.id || "" });
}

function interactionFormat(options, kind) {
  const format = { type: kind };
  const aspectRatio = kind === "video" ? options.aspectRatio : options.size;
  if (aspectRatio) format.aspect_ratio = aspectRatio;
  if (kind === "image") {
    format.mime_type = "image/png";
    if (options.resolution) format.image_size = options.resolution;
  } else {
    if (options.resolution) format.resolution = options.resolution.toLowerCase();
    if (options.duration !== undefined) format.duration = `${options.duration}s`;
  }
  return format;
}

export async function generateGeminiInteraction(context) {
  const { options, input } = context.operation;
  const kind = input.outputType;
  requireGenerationOptions(
    options,
    ["size", "resolution", "duration", "aspectRatio", "imageUrls"],
    "Gemini Interactions",
  );
  const images = await Promise.all(options.imageUrls.map((url) => imageContent(context, url)));
  const body = {
    model: context.modelSpec.model,
    input: [
      { type: "text", text: input.prompt },
      ...images.map((image) => ({ type: "image", mime_type: image.mimeType, data: image.data })),
    ],
    response_format: interactionFormat(options, kind),
    ...(kind === "video" ? { background: true } : { store: false }),
  };
  const created = await generationRequest(context, "interactions", body);
  if (created.status === "completed") return interactionMedia(created, kind);
  const result = await pollGeneration(context, {
    id: created.id,
    path: `interactions/${encodeURIComponent(created.id)}`,
    read: interactionStatus,
    initial: created,
  });
  return interactionMedia(result.payload, kind);
}

export async function generateGeminiContent(context) {
  const { options, input } = context.operation;
  requireGenerationOptions(
    options,
    ["size", "resolution", "imageUrls"],
    "Gemini native image generation",
  );
  const imageConfig = {};
  if (options.size) imageConfig.aspectRatio = options.size;
  if (options.resolution) imageConfig.imageSize = options.resolution;
  const images = await Promise.all(options.imageUrls.map((url) => imageContent(context, url)));
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: input.prompt }, ...images.map((inlineData) => ({ inlineData }))],
      },
    ],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig },
  };
  const path = `models/${encodeURIComponent(context.modelSpec.model)}:generateContent`;
  const payload = await generationRequest(context, path, body);
  const parts = (payload.candidates || []).flatMap((candidate) => candidate.content?.parts || []);
  const artifacts = parts
    .filter((part) => part.inlineData && !part.thought)
    .map((part, index) =>
      generationArtifact({
        kind: "image",
        data: part.inlineData.data,
        mimeType: part.inlineData.mimeType,
        index,
      }),
    );
  return generationResult("image", artifacts, {
    rawText: parts
      .filter((part) => part.text && !part.thought)
      .map((part) => part.text)
      .join("\n"),
  });
}
