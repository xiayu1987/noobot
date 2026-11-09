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
        "查询自身运行说明，命令行风格。不传 command 返回可用命令清单；" +
        "command 形如 --tools、--tools --name {{tool:read_file}}、--tools --name {{tool:execute_native_script}} " +
        "--capability browser、--models、--runtime、--context、--attachs --id xxx。",
    },
    params: {
      command: {
        key: "tools.help.fieldCommand",
        text: "命令行字符串，如 --tools --name {{tool:read_file}} 或 --tools --name {{tool:execute_native_script}} --capability media；不传则返回命令清单。",
      },
    },
    texts: {
      "tools.help.commandIndexHint": "以下为 {{tool:help}} 可用命令，按需选择后再次调用。",
      "tools.help.command.tools":
        "工具手册：不带选项列出可查工具名，--name 查共享说明，--capability 查专项能力。",
      "tools.help.capabilityRequiresToolName": "--capability 必须与 --name 同时使用",
      "tools.help.unknownCapability": "专项能力不存在，请从 capabilities 中选择",
      "tools.help.command.experience": "经验记忆目录路径。",
      "tools.help.command.memory": "长短记忆与日周月年摘要目录路径。",
      "tools.help.command.runtime": "当前运行时路径上下文、工作目录与沙箱形态。",
      "tools.help.command.context": "当前轮身份与调用上下文。",
      "tools.help.command.attachs": "会话附件清单，--id 查单个附件明细，--source 按来源过滤。",
      "tools.help.command.isolation": "执行隔离模式与本会话可用工具的执行面分类。",
      "tools.help.command.models": "当前使用中的模型与本会话可用模型清单及其多模态能力。",
      "tools.help.toolNotAvailable": "该名称在当前会话不可用；请从 toolNames 中选择",
      "tools.help.experienceHint":
        "以下为经验记忆路径，需再用 {{tool:read_file}} 或 {{tool:search}} 读取具体内容。",
      "tools.help.memoryHint":
        "以下为记忆与摘要路径，需再用 {{tool:read_file}} 或 {{tool:search}} 读取具体内容。",
      "tools.help.unknownAttachmentSource": "附件来源不存在，请从 attachmentSources 中选择",
      "tools.help.attachmentNotFound": "附件不存在或不属于当前会话",
      "tools.help.parseError.unknown_command": "命令不存在，请从 commands 中选择",
      "tools.help.parseError.multiple_commands": "一次只能指定一个命令",
      "tools.help.parseError.unknown_option": "选项不存在，请参考 usage",
      "tools.help.parseError.option_not_supported": "当前命令不支持该选项",
      "tools.help.parseError.malformed": "命令格式不正确，需以 --命令 开头",
    },
  },
  do_search_web: {
    description: {
      key: "tools.do_search_web.description",
      text: "搜索网页信息。需要时效性或模型知识之外的事实时必须先调用。输入 query，返回搜索结论与来源。",
    },
    params: {
      query: {
        key: "tools.do_search_web.fieldQuery",
        text: "搜索内容。",
      },
    },
    texts: {
      "tools.do_search_web.modelApiKeyMissing": "模型 API Key 缺失",
      "tools.do_search_web.queryRequired": "query 必填",
      "tools.do_search_web.searchEngineUrlMissing": "搜索引擎模式需要配置 endpoints.search.url",
      "tools.do_search_web.searchFailed": "网页搜索失败",
      "tools.do_search_web.userIdMissing": "运行时用户 ID 缺失",
    },
  },
  multimodal_generate: {
    description: {
      key: "tools.multimodal.description",
      text: "通过模型原生接口生成图片或视频。输入 generation_content、output_type（默认 image），返回媒体附件。",
    },
    params: {
      outputType: {
        key: "tools.multimodal.fieldOutputType",
        text: "输出类型：image（默认）或 video。",
      },
      duration: { key: "tools.multimodal.fieldDuration", text: "视频时长（秒）；MiniMax 必填。" },
      aspectRatio: {
        key: "tools.multimodal.fieldAspectRatio",
        text: "视频宽高比，如 16:9；图片使用 size。",
      },
      complexity: {
        key: "tools.multimodal.fieldComplexity",
        text: "OpenAI 图片复杂度：low、medium 或 high。",
      },
      generation_content: {
        key: "tools.multimodal.fieldGenerationContent",
        text: "生成内容描述。",
      },
      image_urls: {
        key: "tools.multimodal.fieldImageUrls",
        text: "编辑图片或生成视频时使用的参考图片 URL 列表（可选）。",
      },
      model_name: {
        key: "tools.multimodal.fieldModelName",
        text: "模型名称。",
      },
      n: {
        key: "tools.multimodal.fieldN",
        text: "生成图片数量（可选，1-10）。",
      },
      quality: {
        key: "tools.multimodal.fieldQuality",
        text: "图片质量（可选）。",
      },
      resolution: {
        key: "tools.multimodal.fieldResolution",
        text: "模型原生图片或视频分辨率，如 2K、720p 或 768P。",
      },
      size: {
        key: "tools.multimodal.fieldSize",
        text: (params = {}) =>
          `图片尺寸可选，须符合所选 API 契约。配置默认模型：${text(params.model)}。`,
      },
    },
    texts: {
      "tools.multimodal.generateFailed": "多模态生成失败",
      "tools.multimodal.generationContentRequired": "generation_content 必填",
      "tools.multimodal.imagesApiNotEnabledError":
        "当前账号未开通图片生成能力（403 Images API is not enabled）。",

      "tools.multimodal.modelNotFound": (params = {}) =>
        `未找到已配置的多模态生成模型：${text(params.model)}`,
      "tools.multimodal.multimodalUnsupportedError": (params = {}) =>
        `当前模型不支持多模态生成：${text(params.model)}`,
      "tools.multimodal.multimodalUnsupportedMessage":
        "请切换到支持图片或视频生成的模型，或通过 model_name 指定支持生成的模型。",

      "tools.multimodal.capabilityUnavailable":
        "该模型当前无法完成图片或视频生成，请检查模型配置或更换模型。",
    },
  },
  multimodal_parse: {
    description: {
      key: "tools.multimodalParse.description",
      text: "解析图片、二进制文档、音频或视频并保存结果。文本类文件使用 {{tool:read_file}}。source 使用逻辑路径或 attachmentRef。",
    },
    params: {
      inputs: {
        key: "tools.multimodalParse.fieldInputs",
        text: "待解析的图片、二进制文档、音频或视频；每项使用逻辑路径或 attachmentRef。",
      },
      filePath: {
        key: "tools.multimodalParse.fieldFilePath",
        text: "source 为字符串时表示由服务端解析的逻辑文件路径。",
      },
      attachmentRef: {
        key: "tools.multimodalParse.fieldAttachmentRef",
        text: "原样使用上下文中的 attachmentRef。",
      },
      model_name: {
        key: "tools.multimodalParse.fieldModelName",
        text: "用于解析这些文件的模型名称（可选）。",
      },
      prompt: {
        key: "tools.multimodalParse.fieldPrompt",
        text: "解析要求（可选）。",
      },
    },
    texts: {
      "tools.multimodalParse.filePathsRequired": "inputs 至少需要包含一个文件输入",
      "tools.multimodalParse.fileTooLarge": (params = {}) =>
        `所有文件合计必须小于 ${Number(params.maxSizeMB || 50)} MB`,
      "tools.multimodalParse.directTextUnsupported": (
        params = {},
        transformText = (value) => value,
      ) =>
        `以下输入是可直接读取的文本，不属于多模态解析范围：${text(params.inputs)}。${transformText("请使用 {{tool:read_file}} 或资源分段读取。")}`,
      "tools.multimodalParse.svgRasterizerUnavailable":
        "当前环境缺少 SVG 图像转换能力，无法将 SVG 交给多模态模型解析。",
      "tools.multimodalParse.defaultPrompt":
        "请完整解析所有文件内容，保留原始结构和关键信息，按文件区分内容，不要编造内容。",
      "tools.multimodalParse.modelNotFound": "未找到已启用多模态解析的模型",
      "tools.multimodalParse.defaultModelMissing": (params = {}) =>
        `未配置以下输入类型的默认多模态解析模型：${text(params.modalities)}`,
      "tools.multimodalParse.defaultModelConflict":
        "这些输入类型配置了不同的默认解析模型，请显式指定一个支持全部输入类型的 model_name",
    },
  },
  switch_model: {
    description: {
      key: "tools.model.description",
      text: "切换当前会话模型。输入 modelName。返回模型切换结果。",
    },
    params: {
      modelName: {
        key: "tools.model.fieldModelName",
        text: "模型名称。",
      },
    },
    texts: {
      "model.enabledProviderModelNotFound": "未找到已启用的 provider/model",
      "tools.model.switchApplied": "模型已切换，将在本轮后续调用生效",
    },
  },
  user_interaction: {
    description: {
      key: "tools.user_interaction.description",
      text: "发起用户交互收集信息或确认操作。输入 content、fields。返回用户填写结果。",
    },
    params: {
      content: {
        key: "tools.user_interaction.fieldContent",
        text: "交互内容。",
      },
      fields: {
        key: "tools.user_interaction.fieldFieldsPayload",
        text: "字段定义（对象或 JSON 字符串）。",
      },
    },
    texts: {
      "tools.user_interaction.bridgeMissing": "用户交互桥接不可用",
      "tools.user_interaction.cancelled": "已取消",
      "tools.user_interaction.contentRequired": "交互内容/content required",
      "tools.user_interaction.fieldDescription": "字段说明",
      "tools.user_interaction.fieldDisplayName": "字段显示名称",
      "tools.user_interaction.fieldFields": "字段定义列表",
      "tools.user_interaction.fieldName": "字段名（返回对象的 key）",
      "tools.user_interaction.fieldRequired": "是否必填",
      "tools.user_interaction.invalidFieldsPayload": (params = {}) =>
        `字段 payload 无效: ${text(params.reason)}`,
      "tools.user_interaction.invalidResponseObject": "交互返回对象无效",
      "tools.user_interaction.missingRequiredField": (params = {}) =>
        `缺少必填字段: ${text(params.key)}`,
      "tools.user_interaction.sensitiveFieldsBlocked":
        "字段名、显示名或说明命中凭据类敏感词，交互已被拦截。不得向用户索取密码、令牌、密钥、连接串等凭据；如确实不是凭据字段，请改用不含敏感词的字段名后重发。数据库或终端等需要凭据的场景由用户在客户端配置连接器，再通过 {{tool:access_connector}} 访问。",
    },
  },
};
