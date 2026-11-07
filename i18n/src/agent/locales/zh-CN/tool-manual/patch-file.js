/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FILE_TOOL_SCHEMA } from "../tool-schema/files.js";
import { buildPatchFileManual } from "../../../patch-file-manual.js";

export const PATCH_FILE_MANUAL = buildPatchFileManual(
  FILE_TOOL_SCHEMA.patch_file,
  {
    notes: [
      "apply_patch 仅接受 @@ 或 @@ L行号；unified_diff 必须使用标准范围头且行数准确。未知头部、非法正文、无修改 hunk 均拒绝。",
      "无锚点 hunk 仅在当前游标之后唯一匹配；锚点精确定位，不重置游标。不能把函数名与闭括号拆成两个 hunk 表达函数作用域。",
      "read_file_numbered 在定位前解码所有旧行：行号须连续，且必须与显式锚点及原文一致。适配记录在 changes[].adaptations；新增行始终是字面文本。",
      "baseVersions 覆盖全部源与目标且不重复。所有操作读取初始快照；同一源、同一目标在各自角色中最多出现一次。移动按最终状态合成：a→b、b→c 将原 a 保留在 b、原 b 保留在 c。版本冲突后重读并重建。",
      "BOM 作为格式元数据保留，不进入读取和错误上下文的行文本。unified_diff 须在对应旧侧、新侧声明末尾缺失换行，标记必须对应实际最终 EOF。",
      "未修改行保留原换行符；新增行采用源文件首个换行符，无换行符时使用 LF。纯移动保持字节不变；回滚恢复原始字节并校验哈希。",
      "dryRun 执行相同的适配、版本校验和规划，返回变更前后哈希，不写入。实际提交结果见顶层 mutations；多文件提交失败时执行事务回滚并报告回滚冲突。",
    ],
    pitfalls: ["通常省略 root；仅路径带 a/、b/ 前缀时设 strip: 1。"],
  },
  FILE_TOOL_SCHEMA.read_file.texts["tools.file.fieldEncoding"],
);
