/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONTENT_TOOL_SCHEMA = {
  "doc_to_data": {
    "description": {
      "key": "tools.doc2data.description",
      "text": "Extract document content into text data. Input filePath (optional prompt, dpi, parseEngine). parseEngine supports libreoffice/vision and defaults to libreoffice. Vision is not recommended."
    },
    "params": {
      "dpi": {
        "key": "tools.doc2data.fieldDpi",
        "text": "DPI (optional)."
      },
      "filePath": {
        "key": "tools.doc2data.fieldFilePath",
        "text": "Document path."
      },
      "parseEngine": {
        "key": "tools.doc2data.fieldParseEngine",
        "text": "Parse engine (optional): libreoffice or vision. Default is libreoffice. Vision is not recommended."
      },
      "prompt": {
        "key": "tools.doc2data.fieldPrompt",
        "text": "Extraction prompt (optional)."
      }
    },
    "texts": {
      "doc2img.inputFileRequired": "inputFile required",
      "doc2img.noImageOutputFromPdf": "no image output generated from PDF",
      "doc2img.unsupportedFileType": "unsupported file type",
      "tools.doc2data.batchPrompt": (params = {}) =>
    `This is image batch ${Number(params.batchIndex || 1)}, page range ${String(params.range || "")}. Output in page order.`,
      "tools.doc2data.extractPrompt": "Extract all readable text from the document, preserve original structure, and do not fabricate content.",
      "tools.doc2data.imageFileUseMedia2Data": "Image files should be parsed with the media2data tool.",
      "tools.doc2data.libreofficeDocUnsupported": "LibreOffice parsing is disabled for .doc documents. Use parseEngine=vision instead.",
      "tools.doc2data.libreofficeParseFailed": "LibreOffice document parsing failed. You can try parseEngine=vision.",
      "tools.doc2data.libreofficeUnavailable": "LibreOffice parsing is unavailable. Install dependencies or use parseEngine=vision.",
      "tools.doc2data.noImagesProduced": "no images produced"
      ,
      "tools.doc2data.unsupportedParseEngine": (params = {}) =>
    `Unsupported parseEngine: ${String(params.parseEngine || "")}. Allowed values: libreoffice / vision.`
    }
  },
  "media_to_data": {
    "description": {
      "key": "tools.media2data.description",
      "text": "Extract image, audio, or video content into text data. Input filePath (optional prompt). Returns parsed media result."
    },
    "params": {
      "filePath": {
        "key": "tools.media2data.fieldFilePath",
        "text": "Media file path."
      },
      "prompt": {
        "key": "tools.media2data.fieldPrompt",
        "text": "Extraction prompt (optional)."
      }
    },
    "texts": {
      "tools.media2data.extractAudioPrompt": "Extract key information and recognizable text from the audio, keep a clear structure, and do not fabricate content.",
      "tools.media2data.extractImagePrompt": "Extract all readable text from the image, keep original structure, and do not fabricate content.",
      "tools.media2data.extractVideoPrompt": "Extract key information and recognizable text from the video, organize by timeline or structure, and do not fabricate content.",
      "tools.media2data.unsupportedMediaFileType": "unsupported media file type"
    }
  },
  "process_content_task": {
    "description": {
      "key": "tools.content_process.description",
      "text": "Can handle document, audio, and video tasks. Input task and contentPath (optional modelName). contentPath is required. Returns processing result."
    },
    "params": {
      "contentPath": {
        "key": "tools.content_process.fieldContentPath",
        "text": "Content path (required)."
      },
      "modelName": {
        "key": "tools.content_process.fieldModelName",
        "text": "Model name."
      },
      "task": {
        "key": "tools.content_process.fieldTask",
        "text": "Task description."
      }
    },
    "texts": {
      "tools.content_process.dynamicDescDisabled": "Content processing tool: no sub-tools are enabled currently.",
      "tools.content_process.dynamicDescEnabledPrefix": "Content processing tool: currently enabled sub-tools: ",
      "tools.content_process.dynamicDescEnabledSuffix": ". The sub-session can only call the enabled tools above.",
      "tools.content_process.errorContentPathRequired": "contentPath is required",
      "tools.content_process.errorToolsUnavailable": "content process tools not available",
      "tools.content_process.toolDescDoc": "Parse document content (extract text from office/pdf/images)",
      "tools.content_process.toolDescGeneric": "Generic content processing",
      "tools.content_process.toolDescMedia": "Parse media content (extract text from audio/video/images)",
      "tools.content_process.toolDescWeb": "Parse webpage content (URL or URL list file)"
    }
  },
  "web_to_data": {
    "description": {
      "key": "tools.web2data.description",
      "text": "Parse webpages and extract content. Input input or urls (optional prompt, useTrafilatura). Returns web extraction result."
    },
    "params": {
      "input": {
        "key": "tools.web2data.fieldInput",
        "text": "Input source (URL or txt file path)."
      },
      "prompt": {
        "key": "tools.web2data.fieldPrompt",
        "text": "Extraction prompt (optional)."
      },
      "urls": {
        "key": "tools.web2data.fieldUrls",
        "text": "URL list."
      },
      "useTrafilatura": {
        "key": "tools.web2data.fieldUseTrafilatura",
        "text": "Prefer Readability extraction (optional)."
      }
    },
    "texts": {
      "tools.web2data.blockedOrUnavailable": (params = {}) =>
    `Access blocked or service unavailable (status=${Number(params.status || 0)})`,
      "tools.web2data.fetchFailedNoResult": "Web extraction failed: no usable result",
      "tools.web2data.fetchFailedWithErrors": (params = {}) =>
    `Web extraction failed: ${String(params.errors || "").trim()}`,
      "tools.web2data.noSuccessfulResult": "web_to_data no successful result",
      "tools.web2data.screenshotBatch": (params = {}) =>
    `This is batch ${Number(params.batchIndex || 1)} of webpage screenshots.\n\nWeb text reference:\n${String(params.sharedText || "")}`,
      "tools.web2data.summarizePrompt": "Based on screenshots and text, extract core webpage information: topic, key facts, data points, conclusions, and code snippets (if any), then output clearly.",
      "tools.web2data.textReference": (params = {}) =>
    `Web text reference:\n${String(params.sharedText || "")}`,
      "tools.web2data.truncated": "[Text too long, truncated]"
    }
  },
};
