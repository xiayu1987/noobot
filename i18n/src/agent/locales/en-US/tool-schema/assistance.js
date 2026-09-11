/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const ASSISTANCE_TOOL_SCHEMA = {
  help: {
    description: {
      key: "tools.help.description",
      text:
        "Look up your own runtime documentation, command-line style. Omit command to list " +
        "available commands; command looks like --tools, --tools --name read_file, --models, " +
        "--runtime, --context, --attachs --id xxx.",
    },
    params: {
      command: {
        key: "tools.help.fieldCommand",
        text:
          "Command-line string such as --tools --name read_file. " +
          "Omit it to list available commands.",
      },
    },
    texts: {
      "tools.help.commandIndexHint":
        "Available help commands. Pick one and call help again with it.",
      "tools.help.command.tools":
        "Tool manuals: without options lists queryable tool names, --name shows one manual.",
      "tools.help.command.experience": "Experience memory directory paths.",
      "tools.help.command.memory":
        "Long and short memory plus daily, weekly, monthly and yearly summary paths.",
      "tools.help.command.runtime":
        "Current runtime path context, working directories and sandbox shape.",
      "tools.help.command.context": "Current turn identity and call context.",
      "tools.help.command.attachs":
        "Session attachments; --id shows one attachment, --source filters by source.",
      "tools.help.command.isolation":
        "Execution isolation modes and the execution class of every available tool.",
      "tools.help.command.models":
        "The model currently in use plus the models available in this session and their multimodal capabilities.",
      "tools.help.manualNotFound":
        "This tool has no extended manual; its schema description is already complete",
      "tools.help.toolNotAvailable":
        "This tool is registered but not assembled in this session and cannot be called; pick one from toolNames",
      "tools.help.unknownTool": "Unknown tool name, pick one from the queryable list",
      "tools.help.experienceHint":
        "The following are memory paths. Use read_file or search to inspect the actual content.",
      "tools.help.memoryHint":
        "The following are memory and summary paths. Use read_file or search to inspect content.",
      "tools.help.attachmentServiceMissing":
        "Attachment service is not assembled, cannot query attachments",
      "tools.help.attachmentUserIdMissing":
        "Current context has no user identity, cannot query attachments",
      "tools.help.attachmentSessionIdMissing":
        "Current context has no session identity, cannot query attachments",
      "tools.help.unknownAttachmentSource":
        "Unknown attachment source, pick one from attachmentSources",
      "tools.help.attachmentNotFound":
        "Attachment does not exist or does not belong to the current session",
      "tools.help.parseError.unknown_command": "Unknown command, pick one from commands",
      "tools.help.parseError.multiple_commands": "Only one command is allowed per call",
      "tools.help.parseError.unknown_option": "Unknown option, check usage",
      "tools.help.parseError.option_not_supported":
        "The current command does not support this option",
      "tools.help.parseError.malformed": "Malformed command, it must start with --command",
    },
  },
  web_search: {
    description: {
      key: "tools.web_search.description",
      text: "Search the web for information. Input query. Returns web search results.",
    },
    params: {
      model_name: {
        key: "tools.web_search.fieldModelName",
        text: "Model name.",
      },
      query: {
        key: "tools.web_search.fieldQuery",
        text: "Search query.",
      },
    },
    texts: {
      "tools.web_search.modelApiKeyMissing": "Model API Key missing",
      "tools.web_search.queryRequired": "query required",
      "tools.web_search.searchEngineUrlMissing": "search_engine mode requires endpoints.search.url",
      "tools.web_search.searchFailed": "web search failed",
      "tools.web_search.userIdMissing": "runtime user ID missing",
    },
  },
  multimodal_generate: {
    description: {
      key: "tools.multimodal.description",
      text: "Generate images from multimodal prompt. Input generation_content (optional model_name, image_size). Returns generated image results.",
    },
    params: {
      generation_content: {
        key: "tools.multimodal.fieldGenerationContent",
        text: "Generation content description.",
      },
      image_size: {
        key: "tools.multimodal.fieldImageSize",
        text: "Image size (optional).",
      },
      image_urls: {
        key: "tools.multimodal.fieldImageUrls",
        text: "Source image URLs for image-to-image or outpainting (optional).",
      },
      model_name: {
        key: "tools.multimodal.fieldModelName",
        text: "Model name.",
      },
      n: {
        key: "tools.multimodal.fieldN",
        text: "Number of images to generate (optional, 1-10).",
      },
      quality: {
        key: "tools.multimodal.fieldQuality",
        text: "Image quality (optional).",
      },
      resolution: {
        key: "tools.multimodal.fieldResolution",
        text: "Image resolution for ratio size (optional, e.g. 1K, 2K, 4K).",
      },
      size: {
        key: "tools.multimodal.fieldSize",
        text: "Image size or aspect ratio (optional, e.g. auto, 1:1, 16:9, 1024x1024).",
      },
    },
    texts: {
      "tools.multimodal.fetchGeneratedImageUrlFailed": "fetch generated image url failed",
      "tools.multimodal.fetchUnavailable": "runtime fetch unavailable",
      "tools.multimodal.generateFailed": "multimodal generate failed",
      "tools.multimodal.generationContentRequired": "generation_content required",
      "tools.multimodal.imagesApiNotEnabledError":
        "Current account does not have image generation enabled (403 Images API is not enabled).",
      "tools.multimodal.imagesApiNotEnabledMessage":
        "Enable Images API on your platform, or switch to a model/key with image generation enabled.",
      "tools.multimodal.modelApiKeyMissing": "model api key missing",
      "tools.multimodal.modelNotFound": (params = {}) =>
        `configured multimodal generation model not found: ${String(params.model || "").trim()}`,
      "tools.multimodal.multimodalUnsupportedError": (params = {}) =>
        `Current model does not support multimodal image generation: ${String(params.model || "").trim()}`,
      "tools.multimodal.multimodalUnsupportedMessage":
        "Switch to a model that supports image generation, or specify one via model_name.",
      "tools.multimodal.taskFailed": "image generation task failed",
      "tools.multimodal.taskIdMissing": "image generation task id missing",
      "tools.multimodal.taskTimeout": (params = {}) =>
        `image generation task timeout: ${String(params.taskId || "").trim()}`,
      "tools.multimodal.trySwitchApiType":
        "Check the image generation API type configured for this model.",
    },
  },
  multimodal_parse: {
    description: {
      key: "tools.multimodalParse.description",
      text: "Parse images, binary documents, audio, or video and save the result. Use read_file for text. source accepts a logical path or attachmentRef.",
    },
    params: {
      inputs: {
        key: "tools.multimodalParse.fieldInputs",
        text: "Images, binary documents, audio, or video to parse; each item uses a logical path or attachmentRef.",
      },
      filePath: {
        key: "tools.multimodalParse.fieldFilePath",
        text: "When source is a string, it is a logical file path resolved by the server.",
      },
      attachmentRef: {
        key: "tools.multimodalParse.fieldAttachmentRef",
        text: "Use the context attachmentRef unchanged.",
      },
      model_name: {
        key: "tools.multimodalParse.fieldModelName",
        text: "Model used to parse the files (optional).",
      },
      prompt: {
        key: "tools.multimodalParse.fieldPrompt",
        text: "Parsing instructions (optional).",
      },
    },
    texts: {
      "tools.multimodalParse.filePathsRequired": "inputs must contain at least one file input",
      "tools.multimodalParse.fileTooLarge": (params = {}) =>
        `The combined file size must be smaller than ${Number(params.maxSizeMB || 50)} MB`,
      "tools.multimodalParse.directTextUnsupported": (params = {}) =>
        `The following inputs are directly readable text and are outside multimodal parsing: ${String(params.inputs || "").trim()}. Use read_file or resource chunk reading.`,
      "tools.multimodalParse.svgRasterizerUnavailable":
        "The current environment has no SVG rasterizer, so the SVG cannot be parsed by a multimodal model.",
      "tools.multimodalParse.defaultPrompt":
        "Parse all files completely, preserve their original structure and key information, distinguish their contents by file, and do not fabricate content.",
      "tools.multimodalParse.modelNotFound":
        "No model is configured with multimodal parsing enabled",
      "tools.multimodalParse.defaultModelMissing": (params = {}) =>
        `No default multimodal parsing model is configured for: ${String(params.modalities || "").trim()}`,
      "tools.multimodalParse.defaultModelConflict":
        "The input types use different default parsing models; specify one model_name that supports every input type",
    },
  },
  switch_model: {
    description: {
      key: "tools.model.description",
      text: "Switch the current session model. Input modelName. Returns model switch result.",
    },
    params: {
      modelName: {
        key: "tools.model.fieldModelName",
        text: "Model name.",
      },
    },
    texts: {
      "model.enabledProviderModelNotFound": "enabled provider/model not found",
      "tools.model.switchApplied":
        "Model switched and will take effect in subsequent calls of this turn",
    },
  },
  final_answer: {
    description: {
      key: "tools.final_answer.description",
      text: "Output the final text response.",
    },
    params: {
      reason: {
        key: "tools.final_answer.fieldReason",
        text: "Reason",
      },
    },
    texts: {
      "tools.final_answer.finalizeMessage":
        "Conversation is ending, please provide the final summary.",
    },
  },
  user_interaction: {
    description: {
      key: "tools.user_interaction.description",
      text: "Request user interaction to collect input or confirm actions. Input content and fields. Returns user-submitted result.",
    },
    params: {
      content: {
        key: "tools.user_interaction.fieldContent",
        text: "Interaction content.",
      },
      fields: {
        key: "tools.user_interaction.fieldFieldsPayload",
        text: "Field definitions (object or JSON string).",
      },
    },
    texts: {
      "tools.user_interaction.bridgeMissing": "user interaction bridge missing",
      "tools.user_interaction.cancelled": "cancelled",
      "tools.user_interaction.contentRequired": "interaction content/content required",
      "tools.user_interaction.fieldDescription": "Field description",
      "tools.user_interaction.fieldDisplayName": "Field display name",
      "tools.user_interaction.fieldFields": "Field definition list",
      "tools.user_interaction.fieldName": "Field name (key in returned object)",
      "tools.user_interaction.fieldRequired": "Whether required",
      "tools.user_interaction.invalidFieldsPayload": (params = {}) =>
        `invalid fields payload: ${String(params.reason || "").trim()}`,
      "tools.user_interaction.invalidResponseObject": "invalid interaction response object",
      "tools.user_interaction.missingRequiredField": (params = {}) =>
        `missing required field: ${String(params.key || "").trim()}`,
      "tools.user_interaction.sensitiveFieldsBlocked":
        "A field name, display name, or description matched a credential keyword, so the interaction was blocked. Never ask the user for passwords, tokens, keys, or connection strings; if the field is not a credential, rename it without the sensitive keyword and send the request again. For database or terminal access that genuinely needs credentials, the user configures a connector in the client and you reach it through access_connector.",
    },
  },
};
