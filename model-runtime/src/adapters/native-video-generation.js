/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  generationArtifact,
  generationRequest,
  generationResult,
  pollGeneration,
} from "./native-generation-http.js";

function videoResult(url, taskId) {
  return generationResult(
    "video",
    [generationArtifact({ kind: "video", url, mimeType: "video/mp4" })],
    { taskId },
  );
}

function xaiStatus(payload) {
  return {
    status: payload.status,
    done: payload.status === "done",
    pending: payload.status === "pending",
    failed: ["failed", "expired"].includes(payload.status),
    message: payload.error?.message,
  };
}

export async function generateXaiVideo(context) {
  const { options, input } = context.operation;
  const body = { model: context.modelSpec.model, prompt: input.prompt };
  if (options.duration !== undefined) body.duration = options.duration;
  if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;
  if (options.resolution) body.resolution = options.resolution.toLowerCase();
  if (options.imageUrls.length === 1) body.image = { url: options.imageUrls[0] };
  if (options.imageUrls.length > 1)
    body.reference_images = options.imageUrls.map((url) => ({ url }));
  const created = await generationRequest(context, "videos/generations", body);
  const result = await pollGeneration(context, {
    id: created.request_id,
    path: `videos/${encodeURIComponent(created.request_id)}`,
    read: xaiStatus,
  });
  return videoResult(result.payload.video?.url, result.taskId);
}

function minimaxStatus(payload) {
  const task = payload.task || {};
  return {
    status: task.status,
    done: task.status === "succeeded",
    pending: ["queued", "running"].includes(task.status),
    failed: ["failed", "cancelled"].includes(task.status),
    message: task.error?.message,
  };
}

export async function generateMinimaxVideo(context) {
  const { options, input } = context.operation;
  const singleImage = options.imageUrls.length === 1;
  if (
    !options.resolution ||
    options.duration === undefined ||
    (!singleImage && !options.aspectRatio)
  )
    throw new TypeError(
      "MiniMax video requires resolution, duration and aspectRatio (except single-image input)",
    );
  if (singleImage && options.aspectRatio)
    throw new TypeError("MiniMax single-image video uses the source aspect ratio");
  const content = [
    { type: "text", text: input.prompt },
    ...options.imageUrls.map((url) => ({
      type: "image_url",
      image_url: { url },
      role: singleImage ? "first_frame" : "reference_image",
    })),
  ];
  const body = {
    model: context.modelSpec.model,
    content,
    resolution: options.resolution,
    duration: options.duration,
    ratio: singleImage ? "adaptive" : options.aspectRatio,
  };
  const created = await generationRequest(context, "video_generation", body);
  const result = await pollGeneration(context, {
    id: created.task_id,
    path: `query/video_generation/${encodeURIComponent(created.task_id)}`,
    read: minimaxStatus,
  });
  return videoResult(result.payload.task?.content?.url, result.taskId);
}

function dashscopeTaskStatus(payload) {
  const output = payload.output || {};
  return {
    status: output.task_status,
    done: output.task_status === "SUCCEEDED",
    pending: ["PENDING", "RUNNING"].includes(output.task_status),
    failed: ["FAILED", "CANCELED", "UNKNOWN"].includes(output.task_status) || Boolean(payload.code),
    message: output.message || payload.message,
  };
}

async function runDashscopeVideo(context, body) {
  const created = await generationRequest(
    context,
    "services/aigc/video-generation/video-synthesis",
    body,
    {
      "X-DashScope-Async": "enable",
    },
  );
  if (created.code) throw new Error(`${created.code}: ${created.message}`);
  const result = await pollGeneration(context, {
    id: created.output?.task_id,
    path: `tasks/${encodeURIComponent(created.output?.task_id)}`,
    read: dashscopeTaskStatus,
  });
  return videoResult(result.payload.output?.video_url, result.taskId);
}

function dashscopeVideoInput(context) {
  const { options, input } = context.operation;
  const mode = context.modelSpec.multimodal_generation.support_generation.input_mode;
  const urls = options.imageUrls;
  if (mode === "text" && urls.length)
    throw new TypeError("text-to-video does not accept source images");
  if (mode === "image" && urls.length !== 1)
    throw new TypeError("image-to-video requires one source image");
  if (mode === "reference" && !urls.length)
    throw new TypeError("reference-to-video requires source images");
  if (mode === "image" && options.aspectRatio)
    throw new TypeError("image-to-video aspect ratio is determined by its source image");
  const firstFrame = mode === "image" || (mode === "auto" && urls.length === 1);
  const media = urls.map((url) => ({ type: firstFrame ? "first_frame" : "reference_image", url }));
  return { prompt: input.prompt, ...(media.length ? { media } : {}) };
}

export async function generateDashscopeVideo(context) {
  const { options } = context.operation;
  const input = dashscopeVideoInput(context);
  const parameters = {};
  if (options.resolution) parameters.resolution = options.resolution.toUpperCase();
  if (options.duration !== undefined) parameters.duration = options.duration;
  if (options.aspectRatio) parameters.ratio = options.aspectRatio;
  return runDashscopeVideo(context, { model: context.modelSpec.model, input, parameters });
}
