/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MULTIMODAL_MANUAL = {
  multimodal_generate: {
    summary: "通过模型原生接口生成图片或视频。",
    usage: [
      "{{tool:multimodal_generate}}({ generation_content, output_type: 'image', model_name, size, n })",
      "{{tool:multimodal_generate}}({ generation_content, output_type: 'video', model_name, duration, aspect_ratio, resolution, image_urls })",
    ],
    params: {
      generation_content: "生成内容描述，必填。",
      output_type: "image（默认）或 video。",
      model_name: "可选；未指定时使用对应输出类型的默认模型。",
      image_urls: "可选参考图片 URL；模型须支持相应输入模式。",
      size: "图片尺寸；像素或宽高比取决于模型原生协议。",
      resolution: "模型原生分辨率；MiniMax H3 必填，如 768P 或 2K。",
      duration: "视频时长（秒）；MiniMax H3 必填。",
      aspect_ratio: "视频宽高比，如 16:9；MiniMax 单图输入按源图比例，其他模式必填。",
      n: "图片数量；视频不使用此参数。",
      quality: "模型支持的图片质量。",
      complexity: "OpenAI 图片复杂度：low、medium 或 high。",
    },
    notes: ["仅选择声明支持目标生成类型的模型；参数按厂商原生协议填写。"],
  },
  multimodal_parse: {
    summary: "解析图片、音频、视频与二进制文档并返回结构化内容。",
    usage: ["{{tool:multimodal_parse}}({ inputs, prompt, model_name })"],
    params: {
      inputs: "待解析项数组，每项为 { source: 逻辑路径或 attachmentRef }，至少一项。",
      prompt: "解析要求，可选。用于指定提取重点与输出结构。",
      model_name: "承担解析的模型名，可选。",
    },
    notes: [
      "文本类文件请用 {{tool:read_file}}，这个工具面向图片、音频、视频与二进制文档。",
      "解析文档或需求时应完整保留原始结构、顺序与逐字文本，含标题、表格、列表、页眉页脚与图示文字。",
      "图片需自顶向下、自左向右逐区识别，并复核边界、底部、侧边、表格单元格、连线标签与小字号文字。",
    ],
    pitfalls: [
      "无法辨认的区域必须明确标注，禁止臆测、擅自修正或用总结替代原文提取。",
      "需明确说明最后一项可见文字与是否存在裁切遮挡，不要给出无法核对的完整性断言。",
    ],
  },
};
