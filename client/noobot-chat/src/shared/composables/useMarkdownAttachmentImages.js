/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { authenticatedResourceAccess } from "../../infrastructure/http/authenticatedHttpService.js";
import { createFilePreviewState } from "./useFilePreview.js";

const IMAGE_SELECTOR = "img[data-noobot-attachment-ref]";

export function useMarkdownAttachmentImages(markdownHtml, onError) {
  const resources = shallowRef(new Map());
  const template = computed(() => {
    const element = document.createElement("template");
    element.innerHTML = markdownHtml.value;
    return element;
  });
  function dispose(resource) {
    resource.stop();
    resource.preview.reset();
  }
  watch(
    template,
    (element) => {
      const urls = new Set(
        [...element.content.querySelectorAll(IMAGE_SELECTOR)].map((image) =>
          image.getAttribute("src"),
        ),
      );
      const next = new Map();
      for (const url of urls) {
        const existing = resources.value.get(url);
        if (existing) {
          next.set(url, existing);
          continue;
        }
        const preview = createFilePreviewState();
        const stop = watch(preview.state.error, (error) => {
          if (error) onError(new Error(error));
        });
        next.set(url, { preview, stop });
        void preview.load(async () => ({
          descriptor: { type: "image", name: "" },
          authorizeResource: (signal) => authenticatedResourceAccess(url, signal),
        }));
      }
      for (const [url, resource] of resources.value) {
        if (!next.has(url)) dispose(resource);
      }
      resources.value = next;
    },
    { immediate: true, flush: "sync" },
  );
  onBeforeUnmount(() => {
    for (const resource of resources.value.values()) dispose(resource);
  });
  return computed(() => {
    const element = template.value.cloneNode(true);
    for (const image of element.content.querySelectorAll(IMAGE_SELECTOR)) {
      const { state } = resources.value.get(image.getAttribute("src")).preview;
      image.removeAttribute("src");
      if (state.error.value) {
        const notice = document.createElement("span");
        notice.setAttribute("role", "alert");
        notice.textContent = `${image.getAttribute("alt")}: ${state.error.value}`;
        image.replaceWith(notice);
      } else if (state.url.value) {
        image.setAttribute("src", state.url.value);
      }
    }
    return element.innerHTML;
  });
}
