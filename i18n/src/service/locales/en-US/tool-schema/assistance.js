/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const ASSISTANCE_TOOL_SCHEMA = {
  "request_help": {
    "description": {
      "key": "tools.request_help.description",
      "text": "Request help tool. Input helpContent and requestType. Supports model help, web-search help, and experience help."
    },
    "params": {
      "helpContent": {
        "key": "tools.request_help.fieldHelpContent",
        "text": "Help request content."
      },
      "requestType": {
        "key": "tools.request_help.fieldRequestType",
        "text": "Request type: all_help (default, model + web search), model_help (model only), web_search_help (web search only), experience_help (returns memory directories for follow-up lookup)."
      }
    },
    "texts": {
      "tools.request_help.helpContentRequired": "helpContent is required"
    }
  },
  "web_search": {
    "description": {
      "key": "tools.web_search.description",
      "text": "Search the web for information. Input query. Returns web search results."
    },
    "params": {
      "query": {
        "key": "tools.web_search.fieldQuery",
        "text": "Search query."
      }
    },
    "texts": {
      "tools.web_search.modelApiKeyMissing": "Model API Key missing",
      "tools.web_search.queryRequired": "query required",
      "tools.web_search.searchEngineUrlMissing": "search_engine mode requires endpoints.search.url",
      "tools.web_search.searchFailed": "web search failed",
      "tools.web_search.userIdMissing": "runtime user ID missing"
    }
  },
  "multimodal_generate": {
    "description": {
      "key": "tools.multimodal.description",
      "text": "Generate images from multimodal prompt. Input generation_content (optional model_name, image_size). Returns generated image results."
    },
    "params": {
      "api_type": {
        "key": "tools.multimodal.fieldApiType",
        "text": "Image generation API type (optional), supports openai_responses and images_async."
      },
      "generation_content": {
        "key": "tools.multimodal.fieldGenerationContent",
        "text": "Generation content description."
      },
      "image_size": {
        "key": "tools.multimodal.fieldImageSize",
        "text": "Image size (optional)."
      },
      "image_urls": {
        "key": "tools.multimodal.fieldImageUrls",
        "text": "Source image URLs for image-to-image or outpainting (optional)."
      },
      "model_name": {
        "key": "tools.multimodal.fieldModelName",
        "text": "Model name."
      },
      "n": {
        "key": "tools.multimodal.fieldN",
        "text": "Number of images to generate (optional, 1-10)."
      },
      "quality": {
        "key": "tools.multimodal.fieldQuality",
        "text": "Image quality (optional)."
      },
      "resolution": {
        "key": "tools.multimodal.fieldResolution",
        "text": "Image resolution for ratio size (optional, e.g. 1K, 2K, 4K)."
      },
      "size": {
        "key": "tools.multimodal.fieldSize",
        "text": "Image size or aspect ratio (optional, e.g. auto, 1:1, 16:9, 1024x1024)."
      }
    },
    "texts": {
      "tools.multimodal.fetchGeneratedImageUrlFailed": "fetch generated image url failed",
      "tools.multimodal.fetchUnavailable": "runtime fetch unavailable",
      "tools.multimodal.generateFailed": "multimodal generate failed",
      "tools.multimodal.generationContentRequired": "generation_content required",
      "tools.multimodal.imagesApiNotEnabledError": "Current account does not have image generation enabled (403 Images API is not enabled).",
      "tools.multimodal.imagesApiNotEnabledMessage": "Enable Images API on your platform, or switch to a model/key with image generation enabled.",
      "tools.multimodal.modelApiKeyMissing": "model api key missing",
      "tools.multimodal.multimodalUnsupportedError": (params = {}) =>
    `Current model does not support multimodal image generation: ${String(params.model || "").trim()}`,
      "tools.multimodal.multimodalUnsupportedMessage": "Switch to a model that supports image generation, or specify one via model_name.",
      "tools.multimodal.taskFailed": "image generation task failed",
      "tools.multimodal.taskIdMissing": "image generation task id missing",
      "tools.multimodal.taskTimeout": (params = {}) =>
    `image generation task timeout: ${String(params.taskId || "").trim()}`,
      "tools.multimodal.trySwitchApiType": "Try switching api_type, for example openai_responses or images_async."
    }
  },
  "switch_model": {
    "description": {
      "key": "tools.model.description",
      "text": "Switch the current session model. Input modelName. Returns model switch result."
    },
    "params": {
      "modelName": {
        "key": "tools.model.fieldModelName",
        "text": "Model name."
      }
    },
    "texts": {
      "model.enabledProviderModelNotFound": "enabled provider/model not found",
      "tools.model.switchApplied": "Model switched and will take effect in subsequent calls of this turn"
    }
  },
  "final_answer": {
    "description": {
      "key": "tools.final_answer.description",
      "text": "Output the final text response."
    },
    "params": {
      "reason": {
        "key": "tools.final_answer.fieldReason",
        "text": "Reason"
      }
    },
    "texts": {
      "tools.final_answer.finalizeMessage": "Conversation is ending, please provide the final summary."
    }
  },
  "user_interaction": {
    "description": {
      "key": "tools.user_interaction.description",
      "text": "Request user interaction to collect input or confirm actions. Input content and fields. Returns user-submitted result."
    },
    "params": {
      "content": {
        "key": "tools.user_interaction.fieldContent",
        "text": "Interaction content."
      },
      "fields": {
        "key": "tools.user_interaction.fieldFieldsPayload",
        "text": "Field definitions (object or JSON string)."
      }
    },
    "texts": {
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
      "tools.user_interaction.sensitiveFieldsBlocked": "Sensitive fields detected. For database or terminal access, use process_connector_tool connectors."
    }
  },
};
