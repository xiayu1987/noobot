/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  generationArtifact,
  generationRequest,
  generationResult,
  requireGenerationOptions,
} from "./native-generation-http.js";

function imagesResult(payload, mimeType = "image/png") {
  const artifacts = (payload.data || []).map((item, index) =>
    generationArtifact({
      kind: "image",
      data: item.b64_json,
      url: item.url,
      mimeType,
      index,
    }),
  );
  return generationResult("image", artifacts);
}

async function imageUpload(context, url) {
  const response = await context.fetchImpl(url, { signal: context.signal });
  if (!response.ok) throw new Error(`source image download failed: HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/"))
    throw new TypeError("source image requires an image media type");
  return blob;
}

export async function generateOpenAiImages(context) {
  const { options, input } = context.operation;
  requireGenerationOptions(
    options,
    ["size", "n", "quality", "complexity", "imageUrls"],
    "Images API",
  );
  if (options.size && !/^(auto|\d+x\d+)$/.test(options.size))
    throw new TypeError("Images API size must be auto or an explicit pixel size such as 1024x1024");
  const body = {
    model: context.modelSpec.model,
    prompt: input.prompt,
    n: options.n,
    output_format: "png",
  };
  for (const key of ["size", "quality", "complexity"]) {
    if (options[key]) body[key] = options[key];
  }
  if (!options.imageUrls.length)
    return imagesResult(await generationRequest(context, "images/generations", body));
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.append(key, String(value));
  for (const url of options.imageUrls)
    form.append("image[]", await imageUpload(context, url), "source");
  return imagesResult(await generationRequest(context, "images/edits", form));
}

export async function generateXaiImages(context) {
  const { options, input } = context.operation;
  requireGenerationOptions(
    options,
    ["size", "resolution", "n", "quality", "imageUrls"],
    "xAI Images API",
  );
  if (options.imageUrls.length > 1)
    throw new TypeError("xAI image editing accepts one source image");
  if (options.size && !/^\d+:\d+$/.test(options.size))
    throw new TypeError("xAI image size must be an aspect ratio such as 16:9");
  const body = {
    model: context.modelSpec.model,
    prompt: input.prompt,
    n: options.n,
    response_format: "b64_json",
  };
  if (options.size) body.aspect_ratio = options.size;
  if (options.resolution) body.resolution = options.resolution.toLowerCase();
  if (options.quality) body.quality = options.quality;
  if (options.imageUrls.length) body.image = { url: options.imageUrls[0] };
  const path = options.imageUrls.length ? "images/edits" : "images/generations";
  return imagesResult(await generationRequest(context, path, body), "image/jpeg");
}

export async function generateDashscopeImages(context) {
  const { options, input } = context.operation;
  requireGenerationOptions(options, ["size", "resolution", "n", "imageUrls"], "DashScope images");
  if (options.size && options.resolution)
    throw new TypeError("DashScope images accept size or resolution, not both");
  const size = options.size || options.resolution;
  if (size && !/^(\d+[x*]\d+|[124]K)$/.test(size))
    throw new TypeError("DashScope image size must be pixels or a supported resolution such as 2K");
  const body = {
    model: context.modelSpec.model,
    input: {
      messages: [
        {
          role: "user",
          content: [...options.imageUrls.map((image) => ({ image })), { text: input.prompt }],
        },
      ],
    },
    parameters: { n: options.n, ...(size ? { size: size.replace("x", "*") } : {}) },
  };
  const payload = await generationRequest(
    context,
    "services/aigc/multimodal-generation/generation",
    body,
  );
  if (payload.code) throw new Error(`${payload.code}: ${payload.message}`);
  const content = (payload.output?.choices || []).flatMap(
    (choice) => choice.message?.content || [],
  );
  const artifacts = content
    .filter((item) => item.image)
    .map((item, index) =>
      generationArtifact({ kind: "image", url: item.image, mimeType: "image/png", index }),
    );
  return generationResult("image", artifacts);
}
