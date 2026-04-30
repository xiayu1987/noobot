/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ElMessage, ElMessageBox } from "element-plus";
import { useLocale } from "../../shared/i18n/useLocale";

export function useUiFeedback() {
  const { t } = useLocale();
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
    await ElMessageBox.confirm(t("infra.confirmDelete"), t("infra.deleteSessionTitle"), {
      confirmButtonText: t("infra.confirm"),
      cancelButtonText: t("infra.cancel"),
      type: "warning",
    });
  }

  return {
    notify,
    confirmDeleteSession,
  };
}
