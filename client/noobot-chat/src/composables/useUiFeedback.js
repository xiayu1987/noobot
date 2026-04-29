/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ElMessage, ElMessageBox } from "element-plus";

export function useUiFeedback() {
  function notify({ type = "info", message = "" } = {}) {
    const text = String(message || "").trim();
    if (!text) return;
    if (type === "success") {
      ElMessage.success(text);
      return;
    }
    if (type === "warning") {
      ElMessage.warning(text);
      return;
    }
    if (type === "error") {
      ElMessage.error(text);
      return;
    }
    ElMessage.info(text);
  }

  async function confirmDeleteSession() {
    await ElMessageBox.confirm("确定要删除吗？", "删除会话", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    });
  }

  return {
    notify,
    confirmDeleteSession,
  };
}
