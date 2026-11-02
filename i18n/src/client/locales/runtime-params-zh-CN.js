/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import time from "./runtime-params-zh-CN-time.js";
import turn from "./runtime-params-zh-CN-turn.js";
import quantity from "./runtime-params-zh-CN-quantity.js";
import length from "./runtime-params-zh-CN-length.js";
import modules from "./runtime-params-zh-CN-modules.js";

export const runtimeParamsZhCN = {
  title: "运行参数",
  activation: "保存后需重启服务及相关运行组件生效，重启后请刷新页面。",
  pending: "已保存版本 {saved}；服务生效版本 {active}，待重启生效。",
  search: "搜索参数名、键名和说明",
  reload: "重新加载",
  restoreAll: "全部恢复默认",
  restore: "恢复默认",
  save: "保存 {count} 项变更",
  saved: "已保存，重启相关运行组件后生效。",
  changes: "待保存差异",
  default: "默认值",
  active: "服务生效值",
  categories: { time: "时间", turn: "轮次", quantity: "数量", length: "长度与容量" },
  allParameters: "全部参数",
  noMatch: "没有匹配的参数",
  units: {
    bytes: "字节",
    characters: "字符",
    milliseconds: "毫秒",
    seconds: "秒",
    days: "天",
    pixels: "像素",
    count: "数量",
  },
  fixed: {
    cryptography: "加密算法固定约束",
    presentation: "界面固定度量",
    bootstrap: "在服务和工作区就绪前读取，无法使用参数快照",
    crossProcess: "多个进程共享的契约值，单侧修改会破坏一致性",
    protocol: "协议固定约束",
  },
  errors: {
    INVALID_RUNTIME_PARAMS: "参数文档必须是对象。",
    UNKNOWN_RUNTIME_PARAM: "提交了未知参数或只读参数。",
    INVALID_RUNTIME_PARAM_VALUE: "参数必须是展示范围内的整数。",
    INVALID_RUNTIME_PARAM_RELATION: "最小值或默认值不能超过对应的最大值。",
    INVALID_RUNTIME_PARAMS_REVISION: "必须提供有效的已保存版本号。",
    RUNTIME_PARAMS_CONFLICT: "其他管理员已修改参数，请重新加载后再保存。",
    RUNTIME_PARAMS_BUSY: "另一项保存正在进行，请在其完成后重试。",
    RUNTIME_PARAMS_LOCK_CORRUPTED: "参数存储锁内容无效，请联系运维检查锁文件。",
    INVALID_RUNTIME_PARAMS_DOCUMENT: "已保存参数文档的版本或字段无效。",
    RUNTIME_PARAMS_ACTOR_REQUIRED: "需要已认证的管理员身份。",
  },
  modules,
  parameters: { time, turn, quantity, length },
};
