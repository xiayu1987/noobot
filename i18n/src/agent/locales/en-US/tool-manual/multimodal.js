/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MULTIMODAL_MANUAL = {
  multimodal_generate: {
    summary: "Generate images or videos through native model APIs.",
    usage: [
      "{{tool:multimodal_generate}}({ generation_content, output_type: 'image', model_name, size, n })",
      "{{tool:multimodal_generate}}({ generation_content, output_type: 'video', model_name, duration, aspect_ratio, resolution, image_urls })",
    ],
    params: {
      generation_content: "Required generation prompt.",
      output_type: "image (default) or video.",
      model_name: "Optional; uses the configured default for the output type.",
      image_urls: "Optional source image URLs; the model must support the input mode.",
      size: "Image pixels or aspect ratio as defined by the model API.",
      resolution: "Native resolution; required for MiniMax H3, e.g. 768P or 2K.",
      duration: "Video duration in seconds; required for MiniMax H3.",
      aspect_ratio:
        "Video ratio, e.g. 16:9; required by MiniMax except single-image input, which uses source ratio.",
      n: "Image count; omit for video.",
      quality: "Native image quality.",
      complexity: "OpenAI image complexity: low, medium or high.",
    },
    notes: ["Select a model declaring the requested output type and use its native parameters."],
  },
  multimodal_parse: {
    summary: "Parse images, audio, video, and binary documents, returning structured content.",
    usage: ["{{tool:multimodal_parse}}({ inputs, prompt, model_name })"],
    params: {
      inputs:
        "Array of items to parse, each { source: logical path or attachmentRef }, at least one.",
      prompt: "Parsing requirements, optional. Use it to set extraction focus and output shape.",
      model_name: "Model that performs the parsing, optional.",
    },
    notes: [
      "Use {{tool:read_file}} for text files; this tool targets images, audio, video, and binary documents.",
      "When parsing documents or requirements, preserve original structure, order, and verbatim text, including headings, tables, lists, headers and footers, and text inside diagrams.",
      "Read images region by region, top to bottom and left to right, and re-check edges, the bottom, sides, table cells, connector labels, and small type.",
    ],
    pitfalls: [
      "Mark unreadable regions explicitly. Do not guess, silently correct, or replace verbatim extraction with a summary.",
      "State the last visible text and whether anything is cropped or occluded, rather than asserting completeness that cannot be verified.",
    ],
  },
};
