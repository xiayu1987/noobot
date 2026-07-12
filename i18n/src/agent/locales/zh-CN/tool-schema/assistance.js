/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const ASSISTANCE_TOOL_SCHEMA = {
  "request_help": {
    "description": {
      "key": "tools.request_help.description",
      "text": "请求帮助工具。输入 helpContent 和 requestType。可请求模型帮助、网页搜索帮助、经验帮助。"
    },
    "params": {
      "helpContent": {
        "key": "tools.request_help.fieldHelpContent",
        "text": "请求帮助内容。"
      },
      "requestType": {
        "key": "tools.request_help.fieldRequestType",
        "text": "请求类型：all_help（默认，模型+网页搜索）、model_help（仅模型）、web_search_help（仅网页搜索）、experience_help（返回记忆目录供后续查询）。"
      }
    },
    "texts": {
      "tools.request_help.helpContentRequired": "helpContent 必填"
    }
  },
  "web_search": {
    "description": {
      "key": "tools.web_search.description",
      "text": "搜索网页信息。输入 query，返回网页搜索结果。"
    },
    "params": {
      "model_name": {
        "key": "tools.web_search.fieldModelName",
        "text": "模型名称。"
      },
      "query": {
        "key": "tools.web_search.fieldQuery",
        "text": "搜索内容。"
      }
    },
    "texts": {
      "tools.web_search.modelApiKeyMissing": "模型 API Key 缺失",
      "tools.web_search.queryRequired": "query 必填",
      "tools.web_search.searchEngineUrlMissing": "搜索引擎模式需要配置 endpoints.search.url",
      "tools.web_search.searchFailed": "网页搜索失败",
      "tools.web_search.userIdMissing": "运行时用户 ID 缺失"
    }
  },
  "multimodal_generate": {
    "description": {
      "key": "tools.multimodal.description",
      "text": "生成图片内容。输入 generation_content（可选 model_name、image_size）。返回生成图片结果。"
    },
    "params": {
      "api_type": {
        "key": "tools.multimodal.fieldApiType",
        "text": "图片生成接口类型（可选），支持 openai_responses、images_async。"
      },
      "generation_content": {
        "key": "tools.multimodal.fieldGenerationContent",
        "text": "生成内容描述。"
      },
      "image_size": {
        "key": "tools.multimodal.fieldImageSize",
        "text": "图片尺寸（可选）。"
      },
      "image_urls": {
        "key": "tools.multimodal.fieldImageUrls",
        "text": "图生图或扩图时使用的原图 URL 列表（可选）。"
      },
      "model_name": {
        "key": "tools.multimodal.fieldModelName",
        "text": "模型名称。"
      },
      "n": {
        "key": "tools.multimodal.fieldN",
        "text": "生成图片数量（可选，1-10）。"
      },
      "quality": {
        "key": "tools.multimodal.fieldQuality",
        "text": "图片质量（可选）。"
      },
      "resolution": {
        "key": "tools.multimodal.fieldResolution",
        "text": "比例尺寸下的图片分辨率（可选，如 1K、2K、4K）。"
      },
      "size": {
        "key": "tools.multimodal.fieldSize",
        "text": "图片尺寸或比例（可选，如 auto、1:1、16:9、1024x1024）。"
      }
    },
    "texts": {
      "tools.multimodal.fetchGeneratedImageUrlFailed": "拉取生成图片 URL 失败",
      "tools.multimodal.fetchUnavailable": "运行时 fetch 不可用",
      "tools.multimodal.generateFailed": "多模态生成失败",
      "tools.multimodal.generationContentRequired": "generation_content 必填",
      "tools.multimodal.imagesApiNotEnabledError": "当前账号未开通图片生成能力（403 Images API is not enabled）。",
      "tools.multimodal.imagesApiNotEnabledMessage": "请在对应平台开通 Images API 权限，或切换到已开通图片生成能力的模型/密钥。",
      "tools.multimodal.modelApiKeyMissing": "模型 API Key 缺失",
      "tools.multimodal.multimodalUnsupportedError": (params = {}) =>
    `当前模型不支持多模态生成（图片）：${String(params.model || "").trim()}`,
      "tools.multimodal.multimodalUnsupportedMessage": "请切换到支持图片生成的模型，或通过 model_name 指定支持生成的模型。",
      "tools.multimodal.taskFailed": "图片生成任务失败",
      "tools.multimodal.taskIdMissing": "图片生成任务 ID 缺失",
      "tools.multimodal.taskTimeout": (params = {}) =>
    `图片生成任务超时：${String(params.taskId || "").trim()}`,
      "tools.multimodal.trySwitchApiType": "请尝试更换 api_type，例如 openai_responses 或 images_async。"
    }
  },
  "switch_model": {
    "description": {
      "key": "tools.model.description",
      "text": "切换当前会话模型。输入 modelName。返回模型切换结果。"
    },
    "params": {
      "modelName": {
        "key": "tools.model.fieldModelName",
        "text": "模型名称。"
      }
    },
    "texts": {
      "model.enabledProviderModelNotFound": "未找到已启用的 provider/model",
      "tools.model.switchApplied": "模型已切换，将在本轮后续调用生效"
    }
  },
  "final_answer": {
    "description": {
      "key": "tools.final_answer.description",
      "text": "输出最终的文本回复。"
    },
    "params": {
      "reason": {
        "key": "tools.final_answer.fieldReason",
        "text": "原因"
      }
    },
    "texts": {
      "tools.final_answer.finalizeMessage": "对话结束请总结"
    }
  },
  "user_interaction": {
    "description": {
      "key": "tools.user_interaction.description",
      "text": "发起用户交互收集信息或确认操作。输入 content、fields。返回用户填写结果。"
    },
    "params": {
      "content": {
        "key": "tools.user_interaction.fieldContent",
        "text": "交互内容。"
      },
      "fields": {
        "key": "tools.user_interaction.fieldFieldsPayload",
        "text": "字段定义（对象或 JSON 字符串）。"
      }
    },
    "texts": {
      "tools.user_interaction.bridgeMissing": "用户交互桥接不可用",
      "tools.user_interaction.cancelled": "已取消",
      "tools.user_interaction.contentRequired": "交互内容/content required",
      "tools.user_interaction.fieldDescription": "字段说明",
      "tools.user_interaction.fieldDisplayName": "字段显示名称",
      "tools.user_interaction.fieldFields": "字段定义列表",
      "tools.user_interaction.fieldName": "字段名（返回对象的 key）",
      "tools.user_interaction.fieldRequired": "是否必填",
      "tools.user_interaction.invalidFieldsPayload": (params = {}) =>
    `字段 payload 无效: ${String(params.reason || "").trim()}`,
      "tools.user_interaction.invalidResponseObject": "交互返回对象无效",
      "tools.user_interaction.missingRequiredField": (params = {}) =>
    `缺少必填字段: ${String(params.key || "").trim()}`,
      "tools.user_interaction.sensitiveFieldsBlocked": "存在敏感字段，如果是数据库或者终端请用 process_connector_tool 连接器连接"
    }
  },
};
