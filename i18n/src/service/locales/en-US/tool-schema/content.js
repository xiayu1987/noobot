/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONTENT_TOOL_SCHEMA = {
  "doc_to_data": {
    "description": {
      "key": "tools.doc2data.description",
      "text": "Extract document content into text data using local document parsing. Input filePath."
    },
    "params": {
      "filePath": {
        "key": "tools.doc2data.fieldFilePath",
        "text": "Document path."
      },
    },
    "texts": {
      "tools.doc2data.imageFileUseMultimodalParse": "Parse image files with multimodal_parse.",
      "tools.doc2data.libreofficeDocUnsupported": "Legacy .doc files are unsupported. Convert the file to .docx or PDF first.",
      "tools.doc2data.libreofficeParseFailed": "Local document parsing failed.",
      "tools.doc2data.libreofficeUnavailable": "Local document parsing is unavailable. Install LibreOffice."
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
