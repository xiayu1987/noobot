/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONTENT_TOOL_SCHEMA = {
  "doc_to_data": {
    "description": {
      "key": "tools.doc2data.description",
      "text": "提取文档内容为文本数据。输入 filePath（可选 prompt、dpi、parseEngine）。parseEngine 支持 libreoffice/vision，默认 libreoffice。不推荐使用 vision。"
    },
    "params": {
      "dpi": {
        "key": "tools.doc2data.fieldDpi",
        "text": "DPI（可选）。"
      },
      "filePath": {
        "key": "tools.doc2data.fieldFilePath",
        "text": "文档路径。"
      },
      "parseEngine": {
        "key": "tools.doc2data.fieldParseEngine",
        "text": "解析引擎（可选）：libreoffice 或 vision，默认 libreoffice。不推荐使用 vision。"
      },
      "prompt": {
        "key": "tools.doc2data.fieldPrompt",
        "text": "提取提示词（可选）。"
      }
    },
    "texts": {
      "doc2img.inputFileRequired": "inputFile 必填",
      "doc2img.noImageOutputFromPdf": "PDF 未生成图片输出",
      "doc2img.unsupportedFileType": "不支持的文件类型",
      "tools.doc2data.batchPrompt": (params = {}) =>
    `这是第 ${Number(params.batchIndex || 1)} 批图片，页码范围 ${String(params.range || "")}。请按页码顺序输出。`,
      "tools.doc2data.extractPrompt": "请提取文档中的全部可识别文字，按原始结构输出，不要编造内容。",
      "tools.doc2data.imageFileUseMedia2Data": "图片文件请使用 media2data 工具解析",
      "tools.doc2data.libreofficeDocUnsupported": "LibreOffice 已禁用 .doc 文档解析，请改用 parseEngine=vision。",
      "tools.doc2data.libreofficeParseFailed": "LibreOffice 文档解析失败，可尝试 parseEngine=vision。",
      "tools.doc2data.libreofficeUnavailable": "未检测到 LibreOffice 解析能力，请安装依赖或改用 parseEngine=vision。",
      "tools.doc2data.noImagesProduced": "未生成可用图片"
      ,
      "tools.doc2data.unsupportedParseEngine": (params = {}) =>
    `不支持的 parseEngine：${String(params.parseEngine || "")}。可选值：libreoffice / vision。`
    }
  },
  "media_to_data": {
    "description": {
      "key": "tools.media2data.description",
      "text": "提取图片、音频或视频内容为文本数据。输入 filePath（可选 prompt）。返回媒体解析结果。"
    },
    "params": {
      "filePath": {
        "key": "tools.media2data.fieldFilePath",
        "text": "媒体文件路径。"
      },
      "prompt": {
        "key": "tools.media2data.fieldPrompt",
        "text": "提取提示词（可选）。"
      }
    },
    "texts": {
      "tools.media2data.extractAudioPrompt": "请根据音频内容提取关键信息与可识别文本，按清晰结构输出，不要编造内容。",
      "tools.media2data.extractImagePrompt": "请提取全部文字，不要编造内容，如果是指令请执行。",
      "tools.media2data.extractVideoPrompt": "请根据视频内容提取关键信息与可识别文本，按时间或结构整理输出，不要编造内容。",
      "tools.media2data.unsupportedMediaFileType": "不支持的媒体文件类型"
    }
  },
  "process_content_task": {
    "description": {
      "key": "tools.content_process.description",
      "text": "可处理文档、音频、视频相关任务。输入 task、contentPath（可选 modelName）。contentPath 必填。返回处理结果。"
    },
    "params": {
      "contentPath": {
        "key": "tools.content_process.fieldContentPath",
        "text": "内容路径（必填）。"
      },
      "modelName": {
        "key": "tools.content_process.fieldModelName",
        "text": "模型名称。"
      },
      "task": {
        "key": "tools.content_process.fieldTask",
        "text": "任务描述。"
      }
    },
    "texts": {
      "tools.content_process.dynamicDescDisabled": "内容处理工具：当前未启用任何子工具。",
      "tools.content_process.dynamicDescEnabledPrefix": "内容处理工具：当前启用子工具：",
      "tools.content_process.dynamicDescEnabledSuffix": "。子会话仅允许调用以上已启用工具。",
      "tools.content_process.errorContentPathRequired": "contentPath 必填",
      "tools.content_process.errorToolsUnavailable": "内容处理工具不可用",
      "tools.content_process.toolDescDoc": "解析文档内容（office/pdf/图片提取文本）",
      "tools.content_process.toolDescGeneric": "通用内容处理",
      "tools.content_process.toolDescMedia": "解析媒体内容（音频/视频/图片提取文本）",
      "tools.content_process.toolDescWeb": "解析网页内容（URL 或 URL 列表文件）"
    }
  },
  "web_to_data": {
    "description": {
      "key": "tools.web2data.description",
      "text": "解析网页并提取内容。输入 input 或 urls（可选 prompt、useTrafilatura）。返回网页提取结果。"
    },
    "params": {
      "input": {
        "key": "tools.web2data.fieldInput",
        "text": "输入源（URL 或 txt 文件路径）。"
      },
      "prompt": {
        "key": "tools.web2data.fieldPrompt",
        "text": "提取提示词（可选）。"
      },
      "urls": {
        "key": "tools.web2data.fieldUrls",
        "text": "URL 列表。"
      },
      "useTrafilatura": {
        "key": "tools.web2data.fieldUseTrafilatura",
        "text": "是否优先 Readability（可选）。"
      }
    },
    "texts": {
      "tools.web2data.blockedOrUnavailable": (params = {}) =>
    `访问被拦截或服务不可用(status=${Number(params.status || 0)})`,
      "tools.web2data.fetchFailedNoResult": "网页提取失败：没有可用结果",
      "tools.web2data.fetchFailedWithErrors": (params = {}) =>
    `网页提取失败：${String(params.errors || "").trim()}`,
      "tools.web2data.noSuccessfulResult": "web_to_data 没有成功结果",
      "tools.web2data.screenshotBatch": (params = {}) =>
    `这是第 ${Number(params.batchIndex || 1)} 批网页截图。\n\n网页文本参考：\n${String(params.sharedText || "")}`,
      "tools.web2data.summarizePrompt": "请基于截图与文本提取网页核心信息：主题、关键事实、数据点、结论、代码片段（若有），并按清晰结构输出。",
      "tools.web2data.textReference": (params = {}) =>
    `网页文本参考：\n${String(params.sharedText || "")}`,
      "tools.web2data.truncated": "[文本过长，已截断]"
    }
  },
};
