/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ElMessage, ElMessageBox } from "element-plus";
import { useLocale } from "../../shared/i18n/useLocale";

export function useUiFeedback() {
  const { translate } = useLocale();
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
    await ElMessageBox.confirm(translate("infra.confirmDelete"), translate("infra.deleteSessionTitle"), {
      confirmButtonText: translate("infra.confirm"),
      cancelButtonText: translate("infra.cancel"),
      type: "warning",
    });
  }

  return {
    notify,
    confirmDeleteSession,
  };
}
