/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const FILE_TOOL_SCHEMA = {
  read_file: {
    description: {
      key: "tools.file.readDescription",
      text: "读取文本文件；numberedContent 每行为“行号\\t原文”，行号前缀不属于原文。",
    },
    params: {
      filePath: {
        key: "tools.file.readFilePathField",
        text: "文件路径。",
      },
      startLine: {
        key: "tools.file.readStartLineField",
        text: "起始行（1-based），超过文件末尾会报错。",
      },
      endLine: {
        key: "tools.file.readEndLineField",
        text: "结束行（1-based），超过文件末尾按末尾截止。",
      },
      maxLines: {
        key: "tools.file.readMaxLinesField",
        text: "最大返回行数；未读完时 hasMore 为 true。",
      },
    },
    texts: {
      "tools.file.fieldEncoding":
        "文本编码：auto 按 UTF BOM 识别，无标记按 UTF-8；UTF-16LE/BE 和 GB18030 可显式指定。更新/移动保留源编码，auto 新建使用 UTF-8；非法或有损转换明确拒绝。",
    },
  },
  write_file: {
    description: {
      key: "tools.file.writeDescription",
      text: "写入 workspace 文本文件。返回文件路径和写入时的变更快照；后续修改不会改变既有快照。回复中链接该文件时照抄结果里的 path（workspace 为相对路径、host 为绝对路径、mount 为挂载路径加相对路径）。",
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
      text: "在工作区文件中搜索，返回命中行与上下文。",
    },
    params: {
      query: {
        key: "tools.search.fieldQuery",
        text: "必填且不能为空的关键词或正则；不要使用空字符串调用 {{tool:search}}。",
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
        text: "搜索的文件或目录。",
      },
      glob: {
        key: "tools.search.fieldGlob",
        text: "文件匹配，例如 *.js。",
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
      "tools.search.pathKindUnsupported": "path 必须是文件或目录。",
    },
  },
  patch_file: {
    description: {
      key: "tools.patch_file.description",
      text: "先 {{tool:read_file}} 获取内容和 baseSha256，原样使用返回路径。每个 hunk 独立定位，上下文须连续且唯一；@@ L行号 精确指定原文起始行。hunk 按原文顺序排列，不重叠。失败后重读并重建补丁。",
    },
    params: {
      patch: {
        key: "tools.patch_file.fieldPatch",
        text: "补丁内容；使用 {{tool:read_file}}/{{tool:search}} 返回的完整 path 和精确上下文，不要改写路径。",
      },
      contentEncoding: {
        key: "tools.patch_file.fieldContentEncoding",
        text: "默认 raw；仅上下文/删除行包含读取行号时设 read_file_numbered。新增行始终按原文处理。",
      },
      baseVersions: {
        key: "tools.patch_file.fieldBaseVersions",
        text: "所有源文件与目标文件的基准版本 [{filePath, sha256}]；filePath 对应补丁路径（strip 后、root 前），sha256 使用读取结果 baseSha256，不存在的新增目标用 null。",
      },
      format: {
        key: "tools.patch_file.fieldFormat",
        text: "补丁格式；省略时根据内容识别，显式格式与内容不一致会被拒绝。",
      },
      strip: {
        key: "tools.patch_file.fieldStrip",
        text: "默认 0；仅路径带 a/、b/ 前缀时设 1。",
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
        "普通用户必须原样使用 {{tool:read_file}}/{{tool:search}} 返回的 workspace path，不要改写或添加前缀。",
      "tools.patch_file.fieldPatchPathHintSuperHost":
        "超级管理员也必须原样使用 {{tool:read_file}}/{{tool:search}} 返回的 path；host 绝对路径同样不得改写或添加前缀。",
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
