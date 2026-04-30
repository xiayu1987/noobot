/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nextTick, onMounted, onUpdated, ref } from "vue";
import { renderMermaidInElement } from "../../shared/utils/mermaid-renderer";

export function useMermaidRender() {
  const mermaidHostRef = ref(null);

  function scheduleMermaidRender() {
    nextTick(async () => {
      try {
        await renderMermaidInElement(mermaidHostRef.value);
      } catch {
        // ignore render errors
      }
    });
  }

  onMounted(() => {
    scheduleMermaidRender();
  });

  onUpdated(() => {
    scheduleMermaidRender();
  });

  return {
    mermaidHostRef,
    scheduleMermaidRender,
  };
}

