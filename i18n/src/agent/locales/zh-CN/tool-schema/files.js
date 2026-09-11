/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const FILE_TOOL_SCHEMA = {
  read_file: {
    description: {
      key: "tools.file.readDescription",
      text: "读取文本文件内容。输入 filePath。返回文件文本结果。",
    },
    params: {
      filePath: {
        key: "tools.file.readFilePathField",
        text: "文件路径。",
      },
    },
    texts: {},
  },
  write_file: {
    description: {
      key: "tools.file.writeDescription",
      text: "写入 workspace 文本文件。返回逻辑路径、资源身份和写入时的附件快照；后续修改 workspace 文件不会改变既有附件快照。",
    },
    params: {
      content: {
        key: "tools.file.writeContentField",
        text: "写入内容。",
      },
      filePath: {
        key: "tools.file.writeFilePathField",
        text: "文件路径。",
      },
    },
    texts: {},
  },
  search: {
    description: {
      key: "tools.search.description",
      text: "搜索文件或文本，返回命中行与上下文。",
    },
    params: {
      source: {
        key: "tools.search.fieldSource",
        text: "搜索来源：files 或 text。",
      },
      query: {
        key: "tools.search.fieldQuery",
        text: "必填且不能为空的关键词或正则；不要使用空字符串调用 search。",
      },
      isRegex: {
        key: "tools.search.fieldIsRegex",
        text: "是否按正则搜索。",
      },
      caseSensitive: {
        key: "tools.search.fieldCaseSensitive",
        text: "是否区分大小写。",
      },
      path: {
        key: "tools.search.fieldPath",
        text: "文件搜索路径。",
      },
      glob: {
        key: "tools.search.fieldGlob",
        text: "文件匹配，例如 *.js。",
      },
      text: {
        key: "tools.search.fieldText",
        text: "待搜索文本（source=text 时使用）。",
      },
      contextLines: {
        key: "tools.search.fieldContextLines",
        text: "上下文行数。",
      },
      maxResults: {
        key: "tools.search.fieldMaxResults",
        text: "最大命中数。",
      },
      riskLevel: {
        key: "tools.search.fieldRiskLevel",
        text: "操作风险等级：low、medium、high 或 critical。搜索可能检索或返回隐私信息、密码、令牌、凭证或密钥时必须标记为 critical。",
      },
    },
    texts: {
      "tools.search.queryRequired": "必须提供非空的搜索关键词或正则。",
    },
  },
  patch_file: {
    description: {
      key: "tools.patch_file.description",
      text: "先 read_file/search 确认文件，再按返回的完整 path 修改；省略 root，不要自行添加 project、a/ 或 b/ 前缀。",
    },
    params: {
      patch: {
        key: "tools.patch_file.fieldPatch",
        text: "补丁内容；使用 read_file/search 返回的完整 path 和精确上下文，不要改写路径。",
      },
      format: {
        key: "tools.patch_file.fieldFormat",
        text: "补丁格式；省略时根据内容识别，显式格式与内容不一致会被拒绝。",
      },
      strip: {
        key: "tools.patch_file.fieldStrip",
        text: "路径含 a/、b/ 前缀时才设置对应 strip；使用完整 path 时设为 0。",
      },
      root: {
        key: "tools.patch_file.fieldRoot",
        text: "通常省略；填写时只能是工作区相对子目录，不要用绝对路径或 ..。",
      },
      dryRun: {
        key: "tools.patch_file.fieldDryRun",
        text: "只验证不写入。",
      },
      riskLevel: {
        key: "tools.patch_file.fieldRiskLevel",
        text: "操作风险等级：low、medium、high 或 critical。按与脚本执行相同的影响和破坏性标准分级。",
      },
    },
    texts: {
      "tools.patch_file.fieldPatchPathHintHost":
        "普通用户必须原样使用 read_file/search 返回的 workspace path，不要改写或添加前缀。",
      "tools.patch_file.fieldPatchPathHintSuperHost":
        "超级管理员也必须原样使用 read_file/search 返回的 path；host 绝对路径同样不得改写或添加前缀。",
      "tools.patch_file.fieldRootPathHintSandbox": "通常省略 root；不得填写沙箱绝对路径。",
      "tools.patch_file.fieldRootPathHintHost": "通常省略 root；填写时只能是工作区相对子目录。",
      "tools.patch_file.fieldRootPathHintSuperHost": "通常省略 root；不得填写 host 绝对路径。",
      "tools.patch_file.rootInvalidHintHost":
        "root 通常省略；填写时只能是工作区相对子目录，不得使用绝对路径或 ..。",
      "tools.patch_file.rootInvalidHintSuperHost":
        "root 通常省略；填写时只能是工作区相对子目录，不得使用 host 绝对路径或 ..。",
    },
  },
};
