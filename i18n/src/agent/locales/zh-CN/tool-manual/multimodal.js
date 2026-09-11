/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MULTIMODAL_MANUAL = {
  multimodal_generate: {
    summary: "生成图片内容，支持文生图与基于原图的图生图或扩图。",
    usage: [
      "multimodal_generate({ generation_content, model_name, size, resolution, n, quality })",
      "multimodal_generate({ generation_content, image_urls, size, resolution })",
    ],
    params: {
      generation_content: "生成内容描述，必填。描述越具体，结果越可控。",
      model_name: "模型名，可选。省略时按配置默认图像模型解析。",
      image_urls: "图生图或扩图时使用的原图 URL 列表，可选。",
      size: "尺寸或比例，如 auto、1:1、16:9、1024x1024。",
      resolution: "比例尺寸下的分辨率，如 1K、2K、4K。",
      image_size: "直接指定像素尺寸，可选。",
      n: "生成数量，可选，取值 1 到 10。",
      quality: "图片质量，可选。",
    },
    notes: [
      "可用性取决于是否存在启用且支持图像生成的提供方，无可用提供方时该工具不会出现。",
      "需要多个候选时用 n 一次生成，比反复单张调用更省时。",
    ],
    pitfalls: ["不要为真实人物生成可能造成误认的图像，也不要生成侵权或违规内容。"],
  },
  multimodal_parse: {
    summary: "解析图片、音频、视频与二进制文档并返回结构化内容。",
    usage: ["multimodal_parse({ inputs, prompt, model_name })"],
    params: {
      inputs: "待解析项数组，每项为 { source: 逻辑路径或 attachmentRef }，至少一项。",
      prompt: "解析要求，可选。用于指定提取重点与输出结构。",
      model_name: "承担解析的模型名，可选。",
    },
    notes: [
      "文本类文件请用 read_file，这个工具面向图片、音频、视频与二进制文档。",
      "解析文档或需求时应完整保留原始结构、顺序与逐字文本，含标题、表格、列表、页眉页脚与图示文字。",
      "图片需自顶向下、自左向右逐区识别，并复核边界、底部、侧边、表格单元格、连线标签与小字号文字。",
    ],
    pitfalls: [
      "无法辨认的区域必须明确标注，禁止臆测、擅自修正或用总结替代原文提取。",
      "需明确说明最后一项可见文字与是否存在裁切遮挡，不要给出无法核对的完整性断言。",
    ],
  },
};
