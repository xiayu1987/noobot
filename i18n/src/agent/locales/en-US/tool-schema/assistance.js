/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export const ASSISTANCE_TOOL_SCHEMA = {
  help: {
    description: {
      key: "tools.help.description",
      text:
        "Look up your own runtime documentation, command-line style. Omit command to list " +
        "available commands; command looks like --tools, --tools --name {{tool:read_file}}, " +
        "--tools --name {{tool:execute_native_script}} --capability browser, --models, --runtime, " +
        "--context, --attachs --id xxx.",
    },
    params: {
      command: {
        key: "tools.help.fieldCommand",
        text:
          "Command-line string such as --tools --name {{tool:read_file}} or " +
          "--tools --name {{tool:execute_native_script}} --capability media. " +
          "Omit it to list available commands.",
      },
    },
    texts: {
      "tools.help.commandIndexHint":
        "Available help commands. Pick one and call help again with it.",
      "tools.help.command.tools":
        "Tool manuals: without options lists queryable names, --name shows shared documentation, and --capability shows one specialized capability.",
      "tools.help.capabilityRequiresToolName": "--capability must be used together with --name",
      "tools.help.unknownCapability": "Unknown specialized capability, pick one from capabilities",
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
      "tools.help.toolNotAvailable":
        "This name is unavailable in the current session; pick one from toolNames",
      "tools.help.experienceHint":
        "The following are memory paths. Use {{tool:read_file}} or {{tool:search}} to inspect the actual content.",
      "tools.help.memoryHint":
        "The following are memory and summary paths. Use {{tool:read_file}} or {{tool:search}} to inspect content.",
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
  do_search_web: {
    description: {
      key: "tools.do_search_web.description",
      text: "Search the web. Must be called first when the answer needs current or external facts. Input query. Returns findings with sources.",
    },
    params: {
      query: {
        key: "tools.do_search_web.fieldQuery",
        text: "Search query.",
      },
    },
    texts: {
      "tools.do_search_web.modelApiKeyMissing": "Model API Key missing",
      "tools.do_search_web.queryRequired": "query required",
      "tools.do_search_web.searchEngineUrlMissing":
        "search_engine mode requires endpoints.search.url",
      "tools.do_search_web.searchFailed": "web search failed",
      "tools.do_search_web.userIdMissing": "runtime user ID missing",
    },
  },
  multimodal_generate: {
    description: {
      key: "tools.multimodal.description",
      text: "Generate images or videos through native model APIs. Input generation_content and output_type (image by default). Returns media attachments.",
    },
    params: {
      outputType: {
        key: "tools.multimodal.fieldOutputType",
        text: "Output type: image (default) or video.",
      },
      duration: {
        key: "tools.multimodal.fieldDuration",
        text: "Video duration in seconds; required by MiniMax.",
      },
      aspectRatio: {
        key: "tools.multimodal.fieldAspectRatio",
        text: "Video aspect ratio such as 16:9; image generation uses size.",
      },
      complexity: {
        key: "tools.multimodal.fieldComplexity",
        text: "OpenAI image complexity: low, medium or high.",
      },
      generation_content: {
        key: "tools.multimodal.fieldGenerationContent",
        text: "Generation content description.",
      },
      image_urls: {
        key: "tools.multimodal.fieldImageUrls",
        text: "Source image URLs for editing or video generation (optional).",
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
        text: "Native image or video resolution, such as 2K, 720p or 768P, depending on the model.",
      },
      size: {
        key: "tools.multimodal.fieldSize",
        text: (params = {}) =>
          `Optional image size; obey the selected API contract. Configured default: ${text(params.model)}.`,
      },
    },
    texts: {
      "tools.multimodal.generateFailed": "multimodal generate failed",
      "tools.multimodal.generationContentRequired": "generation_content required",
      "tools.multimodal.imagesApiNotEnabledError":
        "Current account does not have image generation enabled (403 Images API is not enabled).",

      "tools.multimodal.modelNotFound": (params = {}) =>
        `configured multimodal generation model not found: ${text(params.model)}`,
      "tools.multimodal.multimodalUnsupportedError": (params = {}) =>
        `Current model does not support multimodal generation: ${text(params.model)}`,
      "tools.multimodal.multimodalUnsupportedMessage":
        "Switch to a model that supports the requested generation type, or specify one via model_name.",

      "tools.multimodal.capabilityUnavailable":
        "This model cannot serve media generation right now. Check the model configuration or use another model.",
    },
  },
  multimodal_parse: {
    description: {
      key: "tools.multimodalParse.description",
      text: "Parse images, binary documents, audio, or video and save the result. Use {{tool:read_file}} for text. source accepts a logical path or attachmentRef.",
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
      "tools.multimodalParse.directTextUnsupported": (
        params = {},
        transformText = (value) => value,
      ) =>
        `The following inputs are directly readable text and are outside multimodal parsing: ${text(params.inputs)}. ${transformText("Use {{tool:read_file}} or resource chunk reading.")}`,
      "tools.multimodalParse.svgRasterizerUnavailable":
        "The current environment has no SVG rasterizer, so the SVG cannot be parsed by a multimodal model.",
      "tools.multimodalParse.defaultPrompt":
        "Parse all files completely, preserve their original structure and key information, distinguish their contents by file, and do not fabricate content.",
      "tools.multimodalParse.modelNotFound":
        "No model is configured with multimodal parsing enabled",
      "tools.multimodalParse.defaultModelMissing": (params = {}) =>
        `No default multimodal parsing model is configured for: ${text(params.modalities)}`,
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
        `invalid fields payload: ${text(params.reason)}`,
      "tools.user_interaction.invalidResponseObject": "invalid interaction response object",
      "tools.user_interaction.missingRequiredField": (params = {}) =>
        `missing required field: ${text(params.key)}`,
      "tools.user_interaction.sensitiveFieldsBlocked":
        "A field name, display name, or description matched a credential keyword, so the interaction was blocked. Never ask the user for passwords, tokens, keys, or connection strings; if the field is not a credential, rename it without the sensitive keyword and send the request again. For database or terminal access that genuinely needs credentials, the user configures a connector in the client and you reach it through access_connector.",
    },
  },
};
