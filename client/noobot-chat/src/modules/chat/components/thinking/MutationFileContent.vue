<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { watch, onBeforeUnmount } from "vue";
import { ElMessage } from "element-plus";
import { describeFilePreview } from "@noobot/attachment-protocol/preview";
import { isFunction } from "@noobot/shared/value";
import BasePreviewContent from "../../../../shared/ui/BasePreviewContent.vue";
import { createFilePreviewState } from "../../../../shared/composables/useFilePreview.js";
import { handleCopyMarkdown } from "../../../../shared/utils/markdown-copy-feedback.js";
import { renderFileMarkdown } from "../../../../shared/utils/markdown-renderer.js";

const props = defineProps({
  mutation: { type: Object, required: true },
  userId: { type: String, required: true },
  sessionId: { type: String, required: true },
  service: { type: Object, default: null },
  translate: { type: Function, required: true },
});
const preview = createFilePreviewState();
const { descriptor, url, textContent, loading, error } = preview.state;
function copyMarkdown(rich) {
  handleCopyMarkdown({
    markdownText: textContent.value,
    html: rich ? renderFileMarkdown(textContent.value) : "",
    translate: props.translate,
    notify: ElMessage,
    rich,
  });
}
watch(
  () => [props.mutation, props.userId, props.sessionId, props.service],
  () =>
    preview.load(async (signal) => {
      if (!isFunction(props.service?.getFile))
        throw new Error(props.translate("message.mutationFileServiceUnavailable"));
      const payload = await props.service.getFile({
        userId: props.userId,
        sessionId: props.sessionId,
        sessionScope: props.mutation.sessionScope,
        mutationId: props.mutation.mutationId,
        signal,
      });
      if (payload.content === null)
        throw new Error(props.translate(`message.mutationSnapshotState.${payload.snapshot}`));
      const descriptor = describeFilePreview({
        name: props.mutation.fileName,
        size: payload.size,
        isText: payload.isText,
      });
      return {
        descriptor,
        readText: async () => payload.content,
        readBlob: async () => new Blob([payload.content], { type: descriptor.mimeType }),
        editable: false,
      };
    }),
  { immediate: true },
);
onBeforeUnmount(preview.reset);
</script>

<template>
  <BasePreviewContent
    :descriptor="descriptor"
    :url="url"
    :text-content="textContent"
    :loading="loading"
    :error="error"
    @copy-markdown-rich="copyMarkdown(true)"
    @copy-markdown-text="copyMarkdown(false)"
  />
</template>
