/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MULTIMODAL_MANUAL = {
  multimodal_generate: {
    summary:
      "Generate image content, supporting text-to-image plus image-to-image and outpainting from source images.",
    usage: [
      "multimodal_generate({ generation_content, model_name, size, resolution, n, quality })",
      "multimodal_generate({ generation_content, image_urls, size, resolution })",
    ],
    params: {
      generation_content:
        "Description of what to generate, required. The more specific it is, the more controllable the result.",
      model_name: "Model name, optional. Omit to resolve the configured default image model.",
      image_urls: "Source image URLs for image-to-image or outpainting, optional.",
      size: "Size or aspect ratio, e.g. auto, 1:1, 16:9, 1024x1024.",
      resolution: "Resolution under a ratio size, e.g. 1K, 2K, 4K.",
      image_size: "Explicit pixel size, optional.",
      n: "Number of images, optional, 1 to 10.",
      quality: "Image quality, optional.",
    },
    notes: [
      "Availability depends on an enabled provider that supports image generation; without one, this tool is absent.",
      "When several candidates are needed, generate them in one call with n rather than repeating single calls.",
    ],
    pitfalls: [
      "Do not generate images of real people that could be mistaken for them, and do not produce infringing or prohibited content.",
    ],
  },
  multimodal_parse: {
    summary:
      "Parse images, audio, video, and binary documents, returning structured content.",
    usage: ["multimodal_parse({ inputs, prompt, model_name })"],
    params: {
      inputs:
        "Array of items to parse, each { source: logical path or attachmentRef }, at least one.",
      prompt: "Parsing requirements, optional. Use it to set extraction focus and output shape.",
      model_name: "Model that performs the parsing, optional.",
    },
    notes: [
      "Use read_file for text files; this tool targets images, audio, video, and binary documents.",
      "When parsing documents or requirements, preserve original structure, order, and verbatim text, including headings, tables, lists, headers and footers, and text inside diagrams.",
      "Read images region by region, top to bottom and left to right, and re-check edges, the bottom, sides, table cells, connector labels, and small type.",
    ],
    pitfalls: [
      "Mark unreadable regions explicitly. Do not guess, silently correct, or replace verbatim extraction with a summary.",
      "State the last visible text and whether anything is cropped or occluded, rather than asserting completeness that cannot be verified.",
    ],
  },
};
